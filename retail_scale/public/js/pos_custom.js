// Patch the ItemSelector to use qty from backend for dynamic barcodes
(function() {
	// Wait for the page to be ready
	$(document).on('page-change', function() {
		if (frappe.get_route()[0] === 'point-of-sale') {
			// Use a small delay to ensure POS is fully initialized
			setTimeout(patch_item_selector, 500);
		}
	});
	
	// Also try to patch if we're already on the POS page
	if (frappe.get_route()[0] === 'point-of-sale') {
		setTimeout(patch_item_selector, 500);
	}
})();

function patch_item_selector() {
	if (!erpnext.PointOfSale || !erpnext.PointOfSale.ItemSelector) {
		// console.log("⏳ Waiting for POS ItemSelector to load...");
		setTimeout(patch_item_selector, 500);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.ItemSelector.prototype._patched_for_dynamic_barcode) {
		return;
	}
	
	const original_add_filtered = erpnext.PointOfSale.ItemSelector.prototype.add_filtered_item_to_cart;
	
	erpnext.PointOfSale.ItemSelector.prototype.add_filtered_item_to_cart = function() {
		const frm = this.events.get_frm();
		const is_return = frm && frm.doc && frm.doc.is_return;
		
		// Check if the first item has a qty field from dynamic barcode
		if (this.items && this.items.length === 1 && this.items[0].qty) {
			const item = this.items[0];
			let scanned_qty = item.qty;
			const scanned_barcode = item.barcode || "";
			
			// For return invoices, make quantity negative
			if (is_return && scanned_qty > 0) {
				scanned_qty = -Math.abs(scanned_qty);
			}
			
			// Check if item already exists in cart
			const existing_item = frm.doc.items.find(row => 
				row.item_code === item.item_code && 
				(!item.batch_no || row.batch_no === item.batch_no) &&
				(!item.serial_no || row.serial_no === item.serial_no)
			);
			
			if (existing_item) {
				// Item exists - validate before updating quantity
				const current_qty = existing_item.qty || 0;
				const new_qty = current_qty + scanned_qty;
				
				// For return invoices, validate against available quantity
				if (is_return && window.cur_pos && window.cur_pos.validate_return_item) {
					const scanned_barcode_for_validation = scanned_barcode || "";
					const scanned_qty_for_validation = Math.abs(scanned_qty); // Use absolute value for validation
					
					// Create a temporary item object for validation
					const temp_item = {
						item_code: item.item_code,
						batch_no: item.batch_no || existing_item.batch_no,
						serial_no: item.serial_no || existing_item.serial_no
					};
					
					// Validate the new total quantity
					const validation = window.cur_pos.validate_return_item(
						temp_item,
						scanned_barcode_for_validation,
						Math.abs(new_qty) // Total quantity to return (absolute value)
					);
					
					if (!validation.valid) {
						frappe.show_alert({
							message: validation.error,
							indicator: "red",
						});
						frappe.utils.play_sound("error");
						this.set_search_value("");
						return;
					}
				}
				
				// console.log(`Dynamic barcode: Adding qty=${scanned_qty} (current: ${current_qty}, new total: ${new_qty})`);
				
				// Directly update the quantity using frappe.model.set_value
				frappe.model.set_value(existing_item.doctype, existing_item.name, "qty", new_qty)
					.then(() => {
						// Trigger cart update manually
						if (window.cur_pos && window.cur_pos.update_cart_html) {
							window.cur_pos.update_cart_html(existing_item);
						}
					});
				
				this.set_search_value("");
			} else {
				// Item doesn't exist - add new item with scanned quantity
				// console.log(`Dynamic barcode: Adding new item with qty=${scanned_qty}${is_return ? ' (return)' : ''}`);
				
				const item_obj = {
					item_code: item.item_code,
					batch_no: item.batch_no,
					serial_no: item.serial_no,
					uom: item.uom,
					rate: item.price_list_rate,
					stock_uom: item.stock_uom
				};
				
				// Include barcode if available
				if (scanned_barcode) {
					item_obj.barcode = scanned_barcode;
				}
				
				// For return invoices, try to get pos_invoice_item from validation cache
				if (is_return && window.cur_pos && window.cur_pos.return_against_items) {
					// Find matching item in original invoice
					// For weight-embedded barcodes, match by exact quantity
					if (scanned_barcode && scanned_barcode.startsWith("21") && scanned_barcode.length === 12) {
						const extracted_weight = Math.abs(scanned_qty);
						const matching_item = window.cur_pos.return_against_items.find(orig_item => 
							orig_item.item_code === item.item_code && orig_item.qty === extracted_weight
						);
						if (matching_item && matching_item.pos_invoice_item) {
							item_obj.pos_invoice_item = matching_item.pos_invoice_item;
						}
					} else {
						// For regular items, match by item_code and barcode
						const matching_item = window.cur_pos.return_against_items.find(orig_item => 
							orig_item.item_code === item.item_code &&
							(!scanned_barcode || orig_item.barcode === scanned_barcode)
						);
						if (matching_item && matching_item.pos_invoice_item) {
							item_obj.pos_invoice_item = matching_item.pos_invoice_item;
						}
					}
				}
				
				this.events.item_selected({
					field: "qty",
					value: scanned_qty, // Already negative for returns
					item: item_obj
				});
				this.set_search_value("");
			}
		} else {
			// Fall back to original behavior for normal items
			original_add_filtered.call(this);
		}
	};
	
	// Mark as patched
	erpnext.PointOfSale.ItemSelector.prototype._patched_for_dynamic_barcode = true;
	
	// console.log("✅ POS ItemSelector patched for dynamic barcode quantities");
}

// Patch POS Controller for return invoice empty cart and validation
(function() {
	// Wait for the page to be ready
	$(document).on('page-change', function() {
		if (frappe.get_route()[0] === 'point-of-sale') {
			// Use a small delay to ensure POS is fully initialized
			setTimeout(patch_pos_controller, 500);
		}
	});
	
	// Also try to patch if we're already on the POS page
	if (frappe.get_route()[0] === 'point-of-sale') {
		setTimeout(patch_pos_controller, 500);
	}
})();

function patch_pos_controller() {
	if (!erpnext.PointOfSale || !erpnext.PointOfSale.Controller) {
		// console.log("⏳ Waiting for POS Controller to load...");
		setTimeout(patch_pos_controller, 100);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.Controller.prototype._patched_for_return_validation) {
		return;
	}
	
	// Save original methods
	const original_make_return_invoice = erpnext.PointOfSale.Controller.prototype.make_return_invoice;
	const original_on_cart_update = erpnext.PointOfSale.Controller.prototype.on_cart_update;
	
	// Patch make_return_invoice to clear items and fetch original invoice items
	erpnext.PointOfSale.Controller.prototype.make_return_invoice = async function(doc) {
		frappe.dom.freeze();
		this.frm = this.get_new_frm(this.frm);
		this.frm.doc.items = [];
		
		const result = await frappe.call({
			method: "erpnext.accounts.doctype.pos_invoice.pos_invoice.make_sales_return",
			args: {
				source_name: doc.name,
				target_doc: this.frm.doc,
			},
		});
		
		if (result.message) {
			frappe.model.sync(result.message);
			frappe.get_doc(result.message.doctype, result.message.name).__run_link_triggers = false;
			
			// Clear all items from cart
			this.frm.doc.items = [];
			
			// Fetch original invoice items for validation
			if (this.frm.doc.return_against) {
				try {
					const items_result = await frappe.call({
						method: "erpnext.accounts.doctype.pos_invoice.pos_invoice.get_return_against_items",
						args: {
							return_against: this.frm.doc.return_against,
							exclude_return_invoice: this.frm.doc.name || null, // Exclude current return invoice if editing
						},
					});
					
					if (items_result.message) {
						// Store original invoice items in cache
						this.return_against_items = items_result.message;
						
						// Create lookup maps for quick validation
						// Map by item_code (can have multiple items with same item_code)
						this.return_against_items_by_code = {};
						// Map by barcode (only if barcode exists)
						this.return_against_items_by_barcode = {};
						
						items_result.message.forEach((item) => {
							// Map by item_code
							if (!this.return_against_items_by_code[item.item_code]) {
								this.return_against_items_by_code[item.item_code] = [];
							}
							this.return_against_items_by_code[item.item_code].push(item);
							
							// Map by barcode if present
							if (item.barcode && item.barcode.trim()) {
								this.return_against_items_by_barcode[item.barcode] = item;
							}
						});
						
						// console.log("✅ Original invoice items cached for validation", this.return_against_items.length);
						// console.log("📋 Original invoice items details:", JSON.stringify(this.return_against_items, null, 2));
						// console.log("📋 Items by code:", Object.keys(this.return_against_items_by_code));
						// console.log("📋 Items by barcode:", Object.keys(this.return_against_items_by_barcode));
					}
				} catch (error) {
					console.error("Error fetching original invoice items:", error);
				}
			}
			
			// Update cart to reflect empty state
			if (this.cart && this.cart.load_invoice) {
				this.cart.load_invoice();
			}
			
			// Update return indicator
			if (this.cart && this.cart.update_return_indicator) {
				this.cart.update_return_indicator();
			}
			
			await this.set_pos_profile_data();
		}
		
		frappe.dom.unfreeze();
		return result;
	};
	
	// Add validation method to Controller prototype
	erpnext.PointOfSale.Controller.prototype.validate_return_item = function(item, scanned_barcode, scanned_qty) {
		// If not a return invoice or no cache, skip validation
		if (!this.frm.doc.is_return || !this.return_against_items || !this.return_against_items.length) {
			return { valid: true };
		}
		
		const item_code = item.item_code;
		
		// console.log("🔍 Validation started:");
		// console.log("  - Scanned item_code:", item_code);
		// console.log("  - Scanned barcode:", scanned_barcode);
		// console.log("  - Scanned qty:", scanned_qty);
		// console.log("  - Original invoice:", this.frm.doc.return_against);
		// console.log("  - Available original items:", this.return_against_items.length);
		
		// Check if barcode is weight-embedded (retail_scale format: 21-XXXXX-XXXXX)
		let is_weight_barcode = false;
		let extracted_weight = null;
		
		if (scanned_barcode && scanned_barcode.startsWith("21") && scanned_barcode.length === 12) {
			is_weight_barcode = true;
			try {
				const weight_str = scanned_barcode.substring(7, 12); // Last 5 digits
				extracted_weight = parseFloat(weight_str) / 1000; // Convert grams to kg
				// console.log("  - Weight-embedded barcode detected");
				// console.log("  - Extracted weight (kg):", extracted_weight);
			} catch (e) {
				console.error("Error extracting weight from barcode:", e);
			}
		}
		
		// Find matching items: by barcode first (if provided), then by item_code
		let matching_items = [];
		
		if (scanned_barcode && scanned_barcode.trim() && this.return_against_items_by_barcode[scanned_barcode]) {
			// Found by barcode
			matching_items = [this.return_against_items_by_barcode[scanned_barcode]];
			// console.log("  - Found item by barcode:", scanned_barcode);
		} else if (this.return_against_items_by_code[item_code]) {
			// Found by item_code
			matching_items = this.return_against_items_by_code[item_code];
			// console.log("  - Found items by item_code:", item_code, "Count:", matching_items.length);
		}
		
		// console.log("  - Matching items by item_code:", matching_items.length);
		// matching_items.forEach((orig_item, idx) => {
		// 	console.log(`    [${idx}] Item: ${orig_item.item_code}, Barcode: "${orig_item.barcode}", Qty: ${orig_item.qty}, Batch: "${orig_item.batch_no}", Serial: "${orig_item.serial_no}", Available: ${orig_item.available_qty}`);
		// });
		
		if (matching_items.length === 0) {
			return {
				valid: false,
				error: __("Item {0} was not in the original invoice {1}", [
					item_code.bold(),
					this.frm.doc.return_against.bold()
				])
			};
		}
		
		// Find exact match
		let matched_item = null;
		
		// For weight-embedded barcodes: Match by exact quantity
		// For regular items: Match by item_code or barcode (already found above)
		if (is_weight_barcode && extracted_weight !== null) {
			// console.log("  🔍 Weight-embedded barcode: Matching by exact quantity");
			
			for (const orig_item of matching_items) {
				// For weight-embedded barcodes, match by exact quantity
				const qty_match = extracted_weight === orig_item.qty; // Exact match, no tolerance
				
				// console.log(`  Checking match for item ${orig_item.item_code}:`);
				// console.log(`    - Original qty: ${orig_item.qty}`);
				// console.log(`    - Extracted weight: ${extracted_weight}`);
				// console.log(`    - Qty exact match: ${qty_match}`);
				
				if (qty_match) {
					matched_item = orig_item;
					// console.log("  ✅ Exact match found for weight-embedded barcode!");
					break;
				}
			}
		} else {
			// Regular item: Already found by item_code or barcode, use first match
			if (matching_items.length > 0) {
				matched_item = matching_items[0];
				// console.log("  ✅ Match found by item_code or barcode!");
			}
		}
		
		if (!matched_item) {
			if (is_weight_barcode) {
				// console.log("  ❌ No match found for weight-embedded barcode");
				return {
					valid: false,
					error: __("Item {0} with quantity {1} was not found in the original invoice", [
						item_code.bold(),
						extracted_weight.toFixed(3).bold()
					])
				};
			} else {
				console.log("  ❌ No match found");
				return {
					valid: false,
					error: __("Barcode {0} does not match the original invoice item", [
						(scanned_barcode || item_code).bold()
					])
				};
			}
		}
		
		// Check available quantity limits
		const return_qty = scanned_qty || (is_weight_barcode && extracted_weight) || item.qty || 0;
		const available_qty = matched_item.available_qty || 0;
		
		if (return_qty > available_qty) {
			return {
				valid: false,
				error: __("Quantity {0} exceeds available return quantity {1}", [
					return_qty.toFixed(3).bold(),
					available_qty.toFixed(3).bold()
				])
			};
		}
		
		if (available_qty <= 0) {
			return {
				valid: false,
				error: __("This item has already been fully returned")
			};
		}
		
		// Check batch/serial match if original had them
		if (matched_item.batch_no && batch_no !== matched_item.batch_no) {
			return {
				valid: false,
				error: __("Batch number does not match the original invoice item")
			};
		}
		
		if (matched_item.serial_no && serial_no) {
			const orig_serials = matched_item.serial_no.split('\n').filter(s => s.trim());
			if (!orig_serials.includes(serial_no)) {
				return {
					valid: false,
					error: __("Serial number does not match the original invoice item")
				};
			}
		}
		
		return {
			valid: true,
			matched_item: matched_item
		};
	};
	
	// Patch on_cart_update to validate items before adding
	erpnext.PointOfSale.Controller.prototype.on_cart_update = async function(args) {
		let scanned_barcode = ""; // Store for use after original method call
		let extracted_weight = null; // Store for use after original method call
		let is_weight_barcode = false; // Store for use after original method call
		
		// If this is a return invoice, intercept and fix the +1 increment logic
		if (this.frm.doc.is_return && !$.isEmptyObject(args)) {
			const { field, value, item } = args;
			
			// Prevent +1 increment logic for return invoices
			// If value is "+1" and we have a weight-embedded barcode, replace it with extracted weight
			if (field === "qty" && value === "+1" && item && item.item_code) {
				// Check if this is a weight-embedded barcode
				const item_barcode = item.barcode || "";
				if (item_barcode.startsWith("21") && item_barcode.length === 12) {
					try {
						const weight_str = item_barcode.substring(7, 12);
						const weight = parseFloat(weight_str) / 1000;
						args.value = -Math.abs(weight); // Set to negative extracted weight
						args.item = args.item || item;
						args.item.qty = -Math.abs(weight);
						// console.log(`  🔧 Intercepted +1 increment, using extracted weight: ${-Math.abs(weight)}`);
					} catch (e) {
						console.error("Error extracting weight:", e);
					}
				} else {
					// For regular items, set to -1 instead of +1
					args.value = -1;
					args.item = args.item || item;
					args.item.qty = -1;
					// console.log(`  🔧 Intercepted +1 increment, setting to -1 for return`);
				}
			}
			
			const item_row = this.get_item_from_frm(item);
			const item_row_exists = !$.isEmptyObject(item_row);
			
			// Only validate when adding new items (not updating existing ones)
			if (!item_row_exists && item && item.item_code) {
				// Get barcode from multiple possible sources
				scanned_barcode = item.barcode || "";
				
				// Try to get barcode from item selector's current items (if barcode was scanned)
				if (!scanned_barcode && this.item_selector && this.item_selector.items) {
					const matching_item = this.item_selector.items.find(i => i.item_code === item.item_code);
					if (matching_item && matching_item.barcode) {
						scanned_barcode = matching_item.barcode;
					}
				}
				
				// Try to get from search field value if it looks like a barcode
				if (!scanned_barcode && this.item_selector && this.item_selector.search_field) {
					const search_value = this.item_selector.search_field.get_value();
					// If search value matches barcode pattern (especially weight-embedded), use it
					if (search_value && (search_value.length >= 8 || search_value.startsWith("21"))) {
						scanned_barcode = search_value;
					}
				}
				
				// Check if this is a weight-embedded barcode and extract quantity
				if (scanned_barcode && scanned_barcode.startsWith("21") && scanned_barcode.length === 12) {
					is_weight_barcode = true;
					try {
						const weight_str = scanned_barcode.substring(7, 12); // Last 5 digits
						extracted_weight = parseFloat(weight_str) / 1000; // Convert grams to kg
					} catch (e) {
						console.error("Error extracting weight from barcode:", e);
					}
				}
				
				// Use extracted weight for dynamic barcodes, otherwise use scanned_qty
				let scanned_qty = (is_weight_barcode && extracted_weight !== null) ? extracted_weight : (item.qty || (field === "qty" ? value : 0));
				
				// Validate the item
				const validation = this.validate_return_item(item, scanned_barcode, scanned_qty);
				
				if (!validation.valid) {
					frappe.dom.unfreeze();
					frappe.show_alert({
						message: validation.error,
						indicator: "red",
					});
					frappe.utils.play_sound("error");
					return;
				}
				
				// For return invoices, quantities must be negative
				// Use extracted_weight for dynamic barcodes, otherwise use scanned_qty
				let return_qty = scanned_qty;
				if (is_weight_barcode && extracted_weight !== null) {
					return_qty = extracted_weight;
				}
				
				// Make quantity negative for return invoices
				if (return_qty > 0) {
					return_qty = -Math.abs(return_qty);
				}
				
				// If validation passed and we have barcode, ensure it's stored in the item
				if (scanned_barcode && validation.matched_item) {
					item.barcode = scanned_barcode;
					// Also store in args so it gets passed through
					args.item = args.item || item;
					args.item.barcode = scanned_barcode;
					// Store scanned barcode for later use
					args._scanned_barcode = scanned_barcode;
				}
				
				// CRITICAL: Set pos_invoice_item to link back to original invoice item row
				// This is required for server-side validation and returned quantity calculation
				if (validation.matched_item && validation.matched_item.pos_invoice_item) {
					item.pos_invoice_item = validation.matched_item.pos_invoice_item;
					args.item = args.item || item;
					args.item.pos_invoice_item = validation.matched_item.pos_invoice_item;
					args._pos_invoice_item = validation.matched_item.pos_invoice_item;
					// console.log(`  🔗 Linked to original invoice item: ${validation.matched_item.pos_invoice_item}`);
				}
				
				// Update the quantity in args to use the correct (negative) quantity
				args.item = args.item || item;
				args.item.qty = return_qty;
				// Also update the value if field is qty
				// CRITICAL: Override value to prevent +1 increment logic in original method
				if (field === "qty") {
					args.value = return_qty; // Set to negative quantity, not "+1"
					// Mark that we've set a specific quantity to prevent increment logic
					args._return_qty_set = true;
				}
				// Store extracted weight for post-processing
				args._extracted_weight = extracted_weight;
				args._is_weight_barcode = is_weight_barcode;
				// console.log(`  📦 Setting quantity for return: ${return_qty} (extracted_weight: ${extracted_weight}, scanned_qty: ${scanned_qty})`);
			}
		}
		
		// Call original method
		const result = await original_on_cart_update.call(this, args);
		
		// After item is added, ensure quantity is negative and barcode is stored
		if (this.frm.doc.is_return && result) {
			const { item, field } = args;
			if (item && item.item_code && result) {
				// result should be the item_row that was added
				const added_item_row = result;
				
				// Get stored values from args
				const stored_extracted_weight = args._extracted_weight;
				const stored_is_weight_barcode = args._is_weight_barcode;
				
				// Function to set the correct quantity (only called after script triggers to avoid flickering)
				const set_correct_quantity = async () => {
					// For weight-embedded barcodes, ensure exact extracted weight is used (negative)
					if (stored_is_weight_barcode && stored_extracted_weight !== null && added_item_row) {
						const expected_qty = -Math.abs(stored_extracted_weight);
						const current_qty = added_item_row.qty || 0;
						// Only update if quantity doesn't match (accounting for sign)
						if (Math.abs(Math.abs(current_qty) - stored_extracted_weight) > 0.001) {
							try {
								await frappe.model.set_value(added_item_row.doctype, added_item_row.name, "qty", expected_qty);
								added_item_row.qty = expected_qty;
								// console.log(`  📦 Set exact extracted weight quantity: ${expected_qty} (was ${current_qty})`);
								return true; // Indicates we made a change
							} catch (e) {
								console.error("Error setting extracted weight quantity:", e);
							}
						}
					} else if (added_item_row) {
						// For regular items, ensure quantity is negative
						const current_qty = added_item_row.qty || 0;
						if (current_qty > 0 || (current_qty === 0 && field === "qty")) {
							// Use the return_qty we set earlier, or make current qty negative
							const qty_to_set = args._return_qty_set ? (args.item?.qty || -1) : -Math.abs(current_qty || 1);
							try {
								await frappe.model.set_value(added_item_row.doctype, added_item_row.name, "qty", qty_to_set);
								added_item_row.qty = qty_to_set;
								// console.log(`  📦 Corrected quantity to negative: ${added_item_row.qty}`);
								return true; // Indicates we made a change
							} catch (e) {
								console.error("Error setting negative quantity:", e);
							}
						}
					}
					return false; // No change needed
				};
				
				// Skip immediate setting to avoid flickering - wait for script triggers first
				// Wait for trigger_new_item_events to complete (it triggers qty script)
				await new Promise(resolve => setTimeout(resolve, 200));
				
				// Set quantity after script triggers (this is the one that will persist)
				await set_correct_quantity();
				
				// Set quantity one more time after a longer delay to catch any late updates
				setTimeout(async () => {
					await set_correct_quantity();
					// Update cart to reflect changes
					if (this.update_cart_html && added_item_row) {
						this.update_cart_html(added_item_row);
					}
				}, 300);
				
				// Ensure barcode is stored
				const barcode_to_store = scanned_barcode || (args._scanned_barcode || "");
				if (barcode_to_store && !added_item_row.barcode) {
					try {
						// Set barcode field in the form row
						await frappe.model.set_value(added_item_row.doctype, added_item_row.name, "barcode", barcode_to_store);
						// Also update the local object
						added_item_row.barcode = barcode_to_store;
					} catch (e) {
						console.error("Error setting barcode:", e);
					}
				}
				
				// CRITICAL: Ensure pos_invoice_item is set for server-side validation
				const pos_invoice_item_to_store = args._pos_invoice_item;
				if (pos_invoice_item_to_store && !added_item_row.pos_invoice_item) {
					try {
						// Set pos_invoice_item field in the form row
						await frappe.model.set_value(added_item_row.doctype, added_item_row.name, "pos_invoice_item", pos_invoice_item_to_store);
						// Also update the local object
						added_item_row.pos_invoice_item = pos_invoice_item_to_store;
						// console.log(`  🔗 Set pos_invoice_item: ${pos_invoice_item_to_store}`);
					} catch (e) {
						console.error("Error setting pos_invoice_item:", e);
					}
				}
			}
		}
		
		return result;
	};
	
	// Mark as patched
	erpnext.PointOfSale.Controller.prototype._patched_for_return_validation = true;
	
	console.log("✅ POS Controller patched for return invoice validation");
}

// Patch POS Cart to show return order indicator
(function() {
	// Wait for the page to be ready
	$(document).on('page-change', function() {
		if (frappe.get_route()[0] === 'point-of-sale') {
			// Use a small delay to ensure POS is fully initialized
			setTimeout(patch_pos_cart, 500);
		}
	});
	
	// Also try to patch if we're already on the POS page
	if (frappe.get_route()[0] === 'point-of-sale') {
		setTimeout(patch_pos_cart, 500);
	}
})();

function patch_pos_cart() {
	if (!erpnext.PointOfSale || !erpnext.PointOfSale.ItemCart) {
		// console.log("⏳ Waiting for POS ItemCart to load...");
		setTimeout(patch_pos_cart, 500);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.ItemCart.prototype._patched_for_return_indicator) {
		return;
	}
	
	// Save original method
	const original_load_invoice = erpnext.PointOfSale.ItemCart.prototype.load_invoice;
	
	// Patch load_invoice to show return indicator
	erpnext.PointOfSale.ItemCart.prototype.load_invoice = function() {
		const result = original_load_invoice.call(this);
		this.update_return_indicator();
		return result;
	};
	
	// Add method to update return indicator
	erpnext.PointOfSale.ItemCart.prototype.update_return_indicator = function() {
		const frm = this.events.get_frm();
		const $cart_label = this.$component.find(".cart-label");
		const $return_indicator = this.$component.find(".return-order-indicator");
		
		// Remove existing indicator if any
		if ($return_indicator.length) {
			$return_indicator.remove();
		}
		
		// Inject styles if not already injected
		if (!$("#return-order-indicator-styles").length) {
			$("head").append(`
				<style id="return-order-indicator-styles">
					.return-order-indicator {
						background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
						border: 2px solid #f59e0b;
						border-radius: var(--border-radius-md, 8px);
						padding: var(--padding-md, 12px);
						margin-bottom: var(--margin-md, 12px);
						box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2);
					}
					.return-indicator-content {
						display: flex;
						align-items: center;
						gap: var(--margin-md, 12px);
					}
					.return-indicator-icon {
						flex-shrink: 0;
						color: #d97706;
						stroke-width: 2.5;
					}
					.return-indicator-text {
						display: flex;
						flex-direction: column;
						gap: 4px;
						flex: 1;
					}
					.return-indicator-label {
						font-weight: 700;
						font-size: var(--text-md, 14px);
						color: #92400e;
						text-transform: uppercase;
						letter-spacing: 0.5px;
					}
					.return-indicator-invoice {
						font-size: var(--text-sm, 13px);
						color: #78350f;
					}
					.return-indicator-invoice strong {
						font-weight: 600;
						color: #92400e;
					}
				</style>
			`);
		}
		
		// Check if this is a return invoice
		if (frm && frm.doc && frm.doc.is_return && frm.doc.return_against) {
			// Create return indicator banner
			const return_indicator_html = `
				<div class="return-order-indicator">
					<div class="return-indicator-content">
						<svg class="return-indicator-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M9 14L4 9L9 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							<path d="M4 9H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							<path d="M20 20V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
						<div class="return-indicator-text">
							<span class="return-indicator-label">${__("Return Order")}</span>
							<span class="return-indicator-invoice">${__("Original Invoice")}: <strong>${frm.doc.return_against}</strong></span>
						</div>
					</div>
				</div>
			`;
			
			// Insert after cart-label
			$cart_label.after(return_indicator_html);
		}
	};
	
	// Mark as patched
	erpnext.PointOfSale.ItemCart.prototype._patched_for_return_indicator = true;
	
	console.log("✅ POS Cart patched for return order indicator");
}

// Patch POS Controller for password-protected item removal
(function() {
	// Wait for the page to be ready
	$(document).on('page-change', function() {
		if (frappe.get_route()[0] === 'point-of-sale') {
			// Use a small delay to ensure POS is fully initialized
			setTimeout(patch_pos_remove_password, 500);
		}
	});
	
	// Also try to patch if we're already on the POS page
	if (frappe.get_route()[0] === 'point-of-sale') {
		setTimeout(patch_pos_remove_password, 500);
	}
})();

function patch_pos_remove_password() {
	if (!erpnext.PointOfSale || !erpnext.PointOfSale.Controller) {
		// console.log("⏳ Waiting for POS Controller to load...");
		setTimeout(patch_pos_remove_password, 100);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.Controller.prototype._patched_for_remove_password) {
		return;
	}
	
	// Save original method
	const original_remove_item = erpnext.PointOfSale.Controller.prototype.remove_item_from_cart;
	
	// Function to get removal password from doctype
	async function get_removal_password() {
		// Configuration: Change these to match your doctype
		const DOCTYPE_NAME = "POS Key"; // Change this to your doctype name
		const PASSWORD_FIELD = "password"; // Change this to your password field name
		const DEFAULT_PASSWORD = "admin123"; // Fallback if doctype not found
		
		// IMPORTANT: The password field should be of type "Data" with password option,
		// NOT "Password" fieldtype. Password fieldtype stores hashed values that cannot be retrieved.
		
		try {
			// First, get the record name (without password field since it's not allowed in get_list)
			// Filter to only get active (non-disabled) records
			const list_result = await frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: DOCTYPE_NAME,
					fields: ["name"], // Only get name field
					filters: { disabled: 0 }, // Only get active records
					limit: 1,
					order_by: "creation desc" // Get the most recent record
				},
				async: false,
			});
			
			if (list_result.message && list_result.message.length > 0) {
				const record_name = list_result.message[0].name;
				
				// Now get the password field value using get_value
				const value_result = await frappe.call({
					method: "frappe.client.get_value",
					args: {
						doctype: DOCTYPE_NAME,
						filters: { name: record_name },
						fieldname: PASSWORD_FIELD
					},
					async: false,
				});
				
				if (value_result.message && value_result.message[PASSWORD_FIELD]) {
					return value_result.message[PASSWORD_FIELD];
				}
			}
		} catch (e) {
			// Doctype might not exist or no records found
			console.warn("POS Removal Password: Could not fetch from doctype, using default password", e);
		}
		
		// Return default password if doctype fetch fails
		return DEFAULT_PASSWORD;
	}
	
	// Function to show password prompt dialog
	function show_password_prompt() {
		return new Promise((resolve) => {
			let password_input = "";
			let dialog = new frappe.ui.Dialog({
				title: __("Remove Item - Password Required"),
				fields: [
					{
						fieldtype: "HTML",
						options: `
							<div style="padding: 10px 0;">
								<p style="margin-bottom: 15px; color: var(--text-color);">
									${__("Please enter the password to remove this item from the cart.")}
								</p>
							</div>
						`
					},
					{
						fieldtype: "Password",
						label: __("Password"),
						fieldname: "password",
						reqd: 1,
						change: function() {
							password_input = this.value || "";
						}
					}
				],
				primary_action_label: __("Remove Item"),
				primary_action: async function() {
					const correct_password = await get_removal_password();
					
					if (password_input === correct_password) {
						dialog.hide();
						resolve(true);
					} else {
						frappe.show_alert({
							message: __("Incorrect password. Please try again."),
							indicator: "red",
						});
						frappe.utils.play_sound("error");
						// Clear password field
						dialog.fields_dict.password.set_value("");
						password_input = "";
						dialog.fields_dict.password.set_focus();
					}
				},
				secondary_action_label: __("Cancel"),
				secondary_action: function() {
					dialog.hide();
					resolve(false);
				}
			});
			
			dialog.show();
			// Focus password field when dialog opens
			setTimeout(() => {
				if (dialog.fields_dict && dialog.fields_dict.password) {
					dialog.fields_dict.password.set_focus();
				}
			}, 100);
			
			// Handle Enter key press to submit
			dialog.$wrapper.on("keydown", function(e) {
				if (e.keyCode === 13 && !$(e.target).is("textarea")) {
					e.preventDefault();
					dialog.get_primary_btn().click();
				}
				// Handle Escape key to cancel
				if (e.keyCode === 27) {
					dialog.hide();
					resolve(false);
				}
			});
			
			// Clean up event handler when dialog is closed
			dialog.$wrapper.on("hidden.bs.modal", function() {
				dialog.$wrapper.off("keydown");
			});
		});
	}
	
	// Patch remove_item_from_cart to require password
	erpnext.PointOfSale.Controller.prototype.remove_item_from_cart = async function() {
		// Show password prompt
		const password_correct = await show_password_prompt();
		
		if (!password_correct) {
			// Password incorrect or cancelled, don't remove item
			return;
		}
		
		// Password correct, proceed with original removal
		return original_remove_item.call(this);
	};
	
	// Mark as patched
	erpnext.PointOfSale.Controller.prototype._patched_for_remove_password = true;
	
	console.log("✅ POS Controller patched for password-protected item removal");
}

