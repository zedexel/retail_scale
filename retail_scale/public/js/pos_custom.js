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
	erpnext.PointOfSale.Controller.prototype.validate_return_item = function(item, scanned_barcode, scanned_qty, skip_cart_check) {
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
		
		let matching_items = [];
		let matched_item = null;
		let batch_matching_items = []; // Items matching by batch_no
		
		// Check if barcode lookup found exact match
		if (scanned_barcode && scanned_barcode.trim() && this.return_against_items_by_barcode[scanned_barcode]) {
			// Found by barcode - use directly (barcode is unique)
			const barcode_match = this.return_against_items_by_barcode[scanned_barcode];
			
			// For weight-embedded barcodes found by barcode lookup, use directly
			// For regular barcodes found by barcode lookup, use directly
			if (is_weight_barcode && extracted_weight !== null) {
				// Verify quantity matches (safety check)
				if (extracted_weight === barcode_match.qty) {
					matched_item = barcode_match;
				} else {
					// Barcode found but quantity doesn't match - shouldn't happen but handle gracefully
					matching_items = [barcode_match];
				}
			} else {
				// Regular barcode match - use directly
				matched_item = barcode_match;
			}
		} else if (this.return_against_items_by_code[item_code]) {
			// Found by item_code - need to match further
			matching_items = this.return_against_items_by_code[item_code];
		}
		
		
		if (!matched_item && matching_items.length === 0) {
			return {
				valid: false,
				error: __("Item {0} was not in the original invoice {1}", [
					item_code.bold(),
					this.frm.doc.return_against.bold()
				])
			};
		}
		
		// Find exact match if not already found by barcode lookup
		if (!matched_item && matching_items.length > 0) {
			// For weight-embedded barcodes: Match by exact quantity
			// For regular items: Match by item_code or barcode (already found above)
			if (is_weight_barcode && extracted_weight !== null) {
				// console.log("  🔍 Weight-embedded barcode: Matching by exact quantity");
				
				for (const orig_item of matching_items) {
					// For weight-embedded barcodes, match by exact quantity
					const qty_match = extracted_weight === orig_item.qty; // Exact match, no tolerance
					
					if (qty_match) {
						matched_item = orig_item;
						break;
					}
				}
			} else {
				if(item.batch_no){
					batch_matching_items = matching_items.filter(orig_item => 
						orig_item.batch_no === item.batch_no
					);
					if(batch_matching_items.length > 0){
						matched_item = batch_matching_items[0];
					} else {
						return {
							valid: false,
							error: __("Batch number {0} does not match any items in the original invoice", [
								item.batch_no.bold()
							])
						};
					}
				} else {
					if (matching_items.length > 0) {
						matched_item = matching_items[0];
					}
				}
			}
		}
		
		if (!item.batch_no && matched_item.batch_no) {
			// Item scanned doesn't have batch_no but original does - this is invalid
			return {
				valid: false,
				error: __("Batch number is required for this item")
			};
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
		
		// Check batch/serial match if original had them
		if (matched_item.batch_no && item.batch_no !== matched_item.batch_no) {
			return {
				valid: false,
				error: __("Batch number does not match the original invoice item")
			};
		}
		
		if (matched_item.serial_no && item.serial_no) {
			const orig_serials = matched_item.serial_no.split('\n').filter(s => s.trim());
			if (!orig_serials.includes(item.serial_no)) {
				return {
					valid: false,
					error: __("Serial number does not match the original invoice item")
				};
			}
		}
		
		//Quantity validations

		let total_available_qty = 0;
		if (item.batch_no && batch_matching_items.length > 0) {
			// Sum available quantities from all items with matching batch_no
			total_available_qty = batch_matching_items.reduce((sum, orig_item) => {
				return sum + (orig_item.available_qty || 0);
			}, 0);
			console.log(`  📊 Total available quantity for batch ${item.batch_no}: ${total_available_qty} (from ${batch_matching_items.length} items)`);
		} else {
			// Single item match
			total_available_qty = matched_item.available_qty || 0;
		}
		
		const return_qty = scanned_qty || (is_weight_barcode && extracted_weight) || item.qty || 0;
		
		// Get quantity already in cart for this item+batch/barcode combination
		// Skip cart check if this is for an existing item increment (to avoid double-counting)
		let in_cart_quantity = 0;
		if (!skip_cart_check) {
			in_cart_quantity = (this.frm.doc.items || []).find(i => {
				// Match by item_code
				if (i.item_code !== item_code) return false;
				
				// For weight-embedded barcodes, also check barcode match (same barcode = same weight)
				if (is_weight_barcode && scanned_barcode) {
					return i.barcode === scanned_barcode;
				}
				
				// For batch items, check batch_no match
				if (item.batch_no) {
					return i.batch_no === item.batch_no;
				}
				
				// For regular items without batch, match by item_code only
				return true;
			})?.qty || 0;
		}
		
		const total_return_qty = Math.abs(return_qty) + Math.abs(in_cart_quantity);

		if (total_return_qty > total_available_qty) {
			return {
				valid: false,
				error: __("Quantity {0} exceeds available return quantity {1}", [
					total_return_qty.toFixed(3).bold(),
					total_available_qty.toFixed(3).bold()
				])
			};
		}
		
		if (total_available_qty <= 0) {
			return {
				valid: false,
				error: __("This item has already been fully returned")
			};
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
			
			// Handle existing items in return flow - need to accumulate quantities
			if (item_row_exists && field === "qty" && item && item.item_code) {
				console.log(`[Return] Existing item: ${item.item_code}, current_qty: ${item_row.qty}`);
				// Get barcode from multiple possible sources
				let scanned_barcode_for_existing = item.barcode || "";
				
				// Try to get barcode from item selector's current items
				if (!scanned_barcode_for_existing && this.item_selector && this.item_selector.items) {
					const matching_item = this.item_selector.items.find(i => i.item_code === item.item_code);
					if (matching_item && matching_item.barcode) {
						scanned_barcode_for_existing = matching_item.barcode;
					}
				}
				
				// Try to get from search field value if it looks like a barcode
				if (!scanned_barcode_for_existing && this.item_selector && this.item_selector.search_field) {
					const search_value = this.item_selector.search_field.get_value();
					if (search_value && (search_value.length >= 8 || search_value.startsWith("21"))) {
						scanned_barcode_for_existing = search_value;
					}
				}
				
				// Check if this is a weight-embedded barcode
				let is_weight_barcode_existing = false;
				let extracted_weight_existing = null;
				if (scanned_barcode_for_existing && scanned_barcode_for_existing.startsWith("21") && scanned_barcode_for_existing.length === 12) {
					is_weight_barcode_existing = true;
					try {
						const weight_str = scanned_barcode_for_existing.substring(7, 12);
						extracted_weight_existing = parseFloat(weight_str) / 1000;
					} catch (e) {
						console.error("Error extracting weight from barcode:", e);
					}
				}
				
				// Calculate increment amount
				let increment_amount = -1; // Default for batch items
				if (is_weight_barcode_existing && extracted_weight_existing !== null) {
					increment_amount = -Math.abs(extracted_weight_existing);
				}
				
				// Calculate new total quantity
				const current_qty = item_row.qty || 0;
				const new_total_qty = current_qty + increment_amount;
				
				console.log(`[Return] Increment: ${increment_amount}, new_total: ${new_total_qty}`);
				
				// Validate the new total quantity
				// Pass skip_cart_check=true because scanned_qty_for_validation is already the new total
				// and we don't want to add the current cart quantity again
				let scanned_qty_for_validation = Math.abs(new_total_qty);
				if (is_weight_barcode_existing && extracted_weight_existing !== null) {
					scanned_qty_for_validation = extracted_weight_existing;
				}
				
				const validation = this.validate_return_item(item, scanned_barcode_for_existing, scanned_qty_for_validation, true);
				
				if (!validation.valid) {
					console.log(`[Return] Validation failed: ${validation.error}`);
					frappe.dom.unfreeze();
					frappe.show_alert({
						message: validation.error,
						indicator: "red",
					});
					frappe.utils.play_sound("error");
					return;
				}
				
				// For return flow, we need to make from_selector true so original method updates
				// Set value to "+1" so from_selector becomes true, then we'll adjust after original method
				// Store the increment amount so we can apply it correctly
				args.value = "+1";
				args._return_increment_amount = increment_amount; // Store increment (-1 or -weight)
				args._return_increment_mode = true; // Flag to indicate this is an increment operation
				args._expected_new_qty = new_total_qty; // Store expected new quantity for validation
				console.log(`[Return] Validation passed, setting expected_qty: ${new_total_qty}`);
				
				// Store barcode if available
				if (scanned_barcode_for_existing) {
					args._scanned_barcode = scanned_barcode_for_existing;
				}
			}
			
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
		
		// Handle return increment mode - original method added +1, we need -1
		if (this.frm.doc.is_return && result && args._return_increment_mode && args._expected_new_qty !== undefined) {
			const added_item_row = result;
			const before_qty = added_item_row.qty || 0;
			try {
				// Original method calculated: value = current_qty + 1
				// But we want: current_qty - 1
				// So we need to set it to the expected new quantity
				await frappe.model.set_value(added_item_row.doctype, added_item_row.name, "qty", args._expected_new_qty);
				added_item_row.qty = args._expected_new_qty;
				console.log(`[Return] Corrected qty: ${before_qty} → ${args._expected_new_qty}`);
				// Update cart to reflect the change
				if (this.update_cart_html) {
					this.update_cart_html(added_item_row);
				}
			} catch (e) {
				console.error("Error correcting return increment quantity:", e);
			}
		}
		
		// After item is added, ensure quantity is negative and barcode is stored
		if (this.frm.doc.is_return && result) {
			const { item, field } = args;
			if (item && item.item_code && result) {
				// result should be the item_row that was added
				const added_item_row = result;
				
				// Skip quantity correction if we already handled it in increment mode
				if (args._return_increment_mode) {
					// Quantity already corrected above, just ensure barcode is stored
					const barcode_to_store = args._scanned_barcode || "";
					if (barcode_to_store && !added_item_row.barcode) {
						try {
							await frappe.model.set_value(added_item_row.doctype, added_item_row.name, "barcode", barcode_to_store);
							added_item_row.barcode = barcode_to_store;
						} catch (e) {
							console.error("Error setting barcode:", e);
						}
					}
					return result;
				}
				
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

// Patch POS Controller to delay customer requirement until checkout
(function() {
	// Wait for the page to be ready
	$(document).on('page-change', function() {
		if (frappe.get_route()[0] === 'point-of-sale') {
			// Use a small delay to ensure POS is fully initialized
			setTimeout(patch_pos_delayed_customer_check, 500);
		}
	});
	
	// Also try to patch if we're already on the POS page
	if (frappe.get_route()[0] === 'point-of-sale') {
		setTimeout(patch_pos_delayed_customer_check, 500);
	}
})();

function patch_pos_delayed_customer_check() {
	if (!erpnext.PointOfSale || !erpnext.PointOfSale.Controller) {
		// console.log("⏳ Waiting for POS Controller to load...");
		setTimeout(patch_pos_delayed_customer_check, 100);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.Controller.prototype._patched_for_delayed_customer_check) {
		return;
	}
	
	// Save original methods
	const original_on_cart_update = erpnext.PointOfSale.Controller.prototype.on_cart_update;
	const original_save_and_checkout = erpnext.PointOfSale.Controller.prototype.save_and_checkout;
	const original_raise_customer_selection_alert = erpnext.PointOfSale.Controller.prototype.raise_customer_selection_alert;
	
	// Track bypass state per controller instance
	const bypass_state = new WeakMap();
	
	// Override raise_customer_selection_alert to prevent it when bypassing
	erpnext.PointOfSale.Controller.prototype.raise_customer_selection_alert = function() {
		const is_bypassing = bypass_state.get(this);
		if (is_bypassing) {
			// Don't show alert when we're bypassing - just return silently
			return;
		}
		// Show original alert
		return original_raise_customer_selection_alert.call(this);
	};
	
	// Patch on_cart_update to bypass customer check when adding items
	erpnext.PointOfSale.Controller.prototype.on_cart_update = async function(args) {
		// Skip override for return item flow checkout - use original behavior
		if (this.frm.doc.is_return) {
			return await original_on_cart_update.call(this, args);
		}
		
		console.log("🔍 on_cart_update called", args);
		// Check if we're adding a new item (not updating existing)
		const item_row = this.get_item_from_frm(args.item);
		const item_row_exists = !$.isEmptyObject(item_row);
		
		// Only bypass customer check when adding NEW items (not updating existing)
		const had_customer = !!this.frm.doc.customer;
		const should_bypass = !item_row_exists && !had_customer;
		
		if (should_bypass) {
			// Set bypass flag for this instance BEFORE calling original method
			bypass_state.set(this, true);
			
			// Temporarily set customer to a truthy value to bypass the check at line 640
			const TEMP_MARKER = "__BYPASS__";
			const original_customer = this.frm.doc.customer || "";
			
			// Set customer directly on doc object
			this.frm.doc.customer = TEMP_MARKER;
			
			try {
				// Call original method - it will see customer is truthy and proceed
				const result = await original_on_cart_update.call(this, args);
				
				// Restore customer field after item is added
				if (this.frm.doc.customer === TEMP_MARKER || !this.frm.doc.customer) {
					this.frm.doc.customer = original_customer;
					// Refresh the field to update UI
					if (this.frm.refresh_field) {
						this.frm.refresh_field("customer");
					}
				}
				
				return result;
			} catch (error) {
				// Restore customer field even on error
				if (this.frm.doc.customer === TEMP_MARKER || !this.frm.doc.customer) {
					this.frm.doc.customer = original_customer;
					if (this.frm.refresh_field) {
						this.frm.refresh_field("customer");
					}
				}
				throw error;
			} finally {
				// Always clear bypass flag
				bypass_state.set(this, false);
			}
		} else {
			// Customer exists or updating existing item - use original behavior
			return original_on_cart_update.call(this, args);
		}
	};
	
	// Patch save_and_checkout to validate customer before proceeding
	erpnext.PointOfSale.Controller.prototype.save_and_checkout = async function() {
		console.log("🔍 save_and_checkout called, customer:", this.frm.doc.customer);
		// Check if customer is selected before proceeding to checkout
		if (!this.frm.doc.customer) {
			console.log("🔍 No customer selected - blocking checkout");
			this.raise_customer_selection_alert();
			return;
		}
		console.log("🔍 Customer selected - proceeding to checkout");
		
		// Customer is selected, proceed with original checkout logic
		if (this.frm.is_dirty()) {
			let save_error = false;
			await this.frm.save(null, null, null, () => (save_error = true));
			// only move to payment section if save is successful
			!save_error && this.payment.checkout();
			// show checkout button on error
			save_error &&
				setTimeout(() => {
					this.cart.toggle_checkout_btn(true);
				}, 300); // wait for save to finish
		} else {
			this.payment.checkout();
		}
	};
	
	// Mark as patched
	erpnext.PointOfSale.Controller.prototype._patched_for_delayed_customer_check = true;
	
	console.log("✅ POS Controller patched for delayed customer requirement");
}



// Patch POS Payment for one-tap payment method allocation
(function() {
	// Wait for the page to be ready
	$(document).on('page-change', function() {
		if (frappe.get_route()[0] === 'point-of-sale') {
			// Use a small delay to ensure POS is fully initialized
			setTimeout(patch_pos_payment, 500);
		}
	});
	
	// Also try to patch if we're already on the POS page
	if (frappe.get_route()[0] === 'point-of-sale') {
		setTimeout(patch_pos_payment, 500);
	}
})();

function patch_pos_payment() {
	if (!erpnext.PointOfSale || !erpnext.PointOfSale.Payment) {
		// console.log("⏳ Waiting for POS Payment to load...");
		setTimeout(patch_pos_payment, 100);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.Payment.prototype._patched_for_one_tap_allocation) {
		return;
	}
	
	// Save original methods
	const original_bind_events = erpnext.PointOfSale.Payment.prototype.bind_events;
	const original_render_payment_mode_dom = erpnext.PointOfSale.Payment.prototype.render_payment_mode_dom;
	const original_render_payment_section = erpnext.PointOfSale.Payment.prototype.render_payment_section;
	const original_checkout = erpnext.PointOfSale.Payment.prototype.checkout;
	const original_after_render = erpnext.PointOfSale.Payment.prototype.after_render;
	
	// Helper function to check if split bill is enabled
	function is_split_bill_enabled(payment_instance) {
		if (!payment_instance.$split_bill_checkbox || !payment_instance.$split_bill_checkbox.length) {
			return false;
		}
		return payment_instance.$split_bill_checkbox.is(':checked');
	}
	
	// Helper function to attach one-tap allocation handler
	function attach_one_tap_handler(payment_instance) {
		if (!payment_instance || !payment_instance.$payment_modes || !payment_instance.$payment_modes.length) {
			return;
		}
		
		const me = payment_instance;
		
		// Remove ALL click handlers on .mode-of-payment (including original)
		// This ensures our handler is the only one
		me.$payment_modes.off("click", ".mode-of-payment");
		
		// Add custom click handler for one-tap allocation
		// This handler includes all original functionality plus our one-tap logic
		me.$payment_modes.on("click", ".mode-of-payment", function (e) {
			
			const mode_clicked = $(this);
			// if clicked element doesn't have .mode-of-payment class then return
			if (!$(e.target).is(mode_clicked)) return;

			const scrollLeft =
				mode_clicked.offset().left - me.$payment_modes.offset().left + me.$payment_modes.scrollLeft();
			me.$payment_modes.animate({ scrollLeft });

			const mode = mode_clicked.attr("data-mode");
			const frm = me.events.get_frm();
			const doc = frm.doc;
			
			// Check if split bill is enabled
			const split_bill_enabled = is_split_bill_enabled(me);
			
			// Get grand_total (use rounded_total if available, otherwise grand_total)
			const grand_total = cint(frappe.sys_defaults.disable_rounded_total)
				? doc.grand_total
				: doc.rounded_total;

			// hide all control fields and shortcuts
			$(`.mode-of-payment-control`).css("display", "none");
			$(`.cash-shortcuts`).css("display", "none");
			me.$payment_modes.find(`.pay-amount`).css("display", "inline");
			me.$payment_modes.find(`.loyalty-amount-name`).css("display", "none");

			// remove highlight from all mode-of-payments (only if split bill is disabled)
			if (!split_bill_enabled) {
				$(".mode-of-payment").removeClass("border-primary");
			}

			if (mode_clicked.hasClass("border-primary")) {
				// clicked one is selected then unselect it
				mode_clicked.removeClass("border-primary");
				mode_clicked.find(".mode-of-payment-control").css("display", "none");
				mode_clicked.find(".cash-shortcuts").css("display", "none");
				me.$payment_modes.find(`.${mode}-amount`).css("display", "inline");
				me.$payment_modes.find(`.${mode}-name`).css("display", "none");
				
				// Update selected_mode if this was the active one
				if (me.selected_mode === me[`${mode}_control`]) {
					me.selected_mode = "";
				}
				
				// If split bill is disabled, reset all payment methods to 0 when unselecting
				if (!split_bill_enabled) {
					doc.payments.forEach((p) => {
						if (p.amount > 0) {
							frappe.model.set_value(p.doctype, p.name, "amount", 0);
						}
					});
				} else {
					// Split bill enabled - just reset this payment method
					const unselected_payment = doc.payments.find((p) => {
						const payment_mode = me.sanitize_mode_of_payment(p.mode_of_payment);
						return payment_mode === mode;
					});
					if (unselected_payment) {
						frappe.model.set_value(unselected_payment.doctype, unselected_payment.name, "amount", 0);
					}
				}
			} else {
				// clicked one is not selected then select it
				mode_clicked.addClass("border-primary");
				mode_clicked.find(".mode-of-payment-control").css("display", "flex");
				mode_clicked.find(".cash-shortcuts").css("display", "grid");
				me.$payment_modes.find(`.${mode}-amount`).css("display", "none");
				me.$payment_modes.find(`.${mode}-name`).css("display", "inline");

				me.selected_mode = me[`${mode}_control`];
				
				// Check if split bill is enabled
				if (!split_bill_enabled) {
					// SPLIT BILL DISABLED: ONE-TAP ALLOCATION LOGIC
					// 1. Reset all other payment methods to 0
					// 2. Set clicked payment method to grand_total
					// 3. Update UI immediately
					
					// Find the clicked payment method
					const clicked_payment = doc.payments.find((p) => {
						const payment_mode = me.sanitize_mode_of_payment(p.mode_of_payment);
						return payment_mode === mode;
					});
					
					if (clicked_payment) {
						// Collect all payment methods that need to be reset
						const payments_to_reset = doc.payments.filter((p) => {
							return p.name !== clicked_payment.name && p.amount > 0;
						});
						
						// Reset all other payment methods to 0 first (in parallel)
						const reset_promises = payments_to_reset.map((p) => {
							return frappe.model.set_value(p.doctype, p.name, "amount", 0);
						});
						
						// Wait for all resets to complete, then set the clicked payment method
						Promise.all(reset_promises).then(() => {
							// Set clicked payment method to grand_total
							return frappe.model.set_value(
								clicked_payment.doctype,
								clicked_payment.name,
								"amount",
								grand_total
							);
						}).then(() => {
							// Update UI immediately
							me.update_totals_section();
							
							// Update the payment mode display
							const formatted_currency = format_currency(grand_total, doc.currency);
							me.$payment_modes.find(`.${mode}-amount`).html(formatted_currency);
							
							// Update the control value (without triggering change event to avoid loops)
							if (me.selected_mode) {
								// Temporarily disable the onchange to prevent loops
								const original_onchange = me.selected_mode.df.onchange;
								me.selected_mode.df.onchange = function() {};
								me.selected_mode.set_value(grand_total);
								// Restore onchange after a brief delay
								setTimeout(() => {
									me.selected_mode.df.onchange = original_onchange;
								}, 100);
							}
						}).catch((error) => {
							console.error("Error updating payment method:", error);
						});
					} else {
						// Handle loyalty points payment method (special case)
						if (mode === "loyalty-amount") {
							// Reset all other payment methods to 0
							const reset_promises = doc.payments
								.filter((p) => p.amount > 0)
								.map((p) => frappe.model.set_value(p.doctype, p.name, "amount", 0));
							
							Promise.all(reset_promises).then(() => {
								me.selected_mode && me.selected_mode.$input.get(0).focus();
								me.auto_set_remaining_amount();
							});
						} else {
							// Fallback to original behavior
							me.selected_mode && me.selected_mode.$input.get(0).focus();
							me.auto_set_remaining_amount();
						}
					}
				} else {
					// SPLIT BILL ENABLED: Original behavior (manual entry, multi-select allowed)
					// Just focus the input field and let user enter amount manually
					me.selected_mode && me.selected_mode.$input.get(0).focus();
					me.auto_set_remaining_amount();
				}
			}
		});
	}
	
	// Override bind_events to add custom payment method click handler
	erpnext.PointOfSale.Payment.prototype.bind_events = function() {
		// Call original bind_events first
		original_bind_events.call(this);
		
		// Attach our custom handler after a small delay to ensure DOM is ready
		const me = this;
		setTimeout(() => {
			attach_one_tap_handler(me);
		}, 50);
	};
	
	// Override render_payment_mode_dom to re-attach handler after DOM update
	erpnext.PointOfSale.Payment.prototype.render_payment_mode_dom = function() {
		// Call original render_payment_mode_dom first
		original_render_payment_mode_dom.call(this);
		
		// Re-attach our custom handler after DOM is recreated
		const me = this;
		setTimeout(() => {
			attach_one_tap_handler(me);
		}, 50);
	};
	
	// Override render_payment_section to add split bill checkbox and ensure handler is attached
	erpnext.PointOfSale.Payment.prototype.render_payment_section = function() {
		// Call original render_payment_section first
		original_render_payment_section.call(this);
		
		// Add split bill checkbox if not already added
		const me = this;
		if (!me.$split_bill_checkbox || !me.$split_bill_checkbox.length) {
			const split_bill_html = `
				<div class="split-bill-toggle" style="
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 8px 12px;
					margin: 8px 0;
					background: var(--control-bg, #f8f9fa);
					border-radius: 6px;
					cursor: pointer;
				">
					<input type="checkbox" id="split-bill-checkbox" style="
						width: 18px;
						height: 18px;
						cursor: pointer;
					">
					<label for="split-bill-checkbox" style="
						cursor: pointer;
						font-weight: 500;
						font-size: 13px;
						color: var(--text-color, #333);
						margin: 0;
					">
						${__("Split Bill")}
					</label>
				</div>
			`;
			
			// Insert after payment modes, before fields-numpad-container
			me.$payment_modes.after(split_bill_html);
			me.$split_bill_checkbox = me.$component.find("#split-bill-checkbox");
			
			// Bind change event to re-attach handler when toggled
			me.$split_bill_checkbox.on("change", function() {
				// Re-attach handler to apply new behavior
				setTimeout(() => {
					attach_one_tap_handler(me);
				}, 50);
			});
		}
		
		// Re-attach our custom handler
		setTimeout(() => {
			attach_one_tap_handler(me);
		}, 100);
	};
	
	// Override checkout to ensure handler is attached
	erpnext.PointOfSale.Payment.prototype.checkout = function() {
		// Call original checkout first
		original_checkout.call(this);
		
		// Re-attach our custom handler after checkout
		const me = this;
		setTimeout(() => {
			attach_one_tap_handler(me);
		}, 150);
	};
	
	// Override after_render to ensure handler is attached
	erpnext.PointOfSale.Payment.prototype.after_render = function() {
		// Call original after_render first
		original_after_render.call(this);
		
		// Re-attach our custom handler
		const me = this;
		setTimeout(() => {
			attach_one_tap_handler(me);
		}, 50);
	};
	
	// Also listen for paid_amount changes to re-attach handler
	// This is important because render_payment_mode_dom is called when paid_amount changes
	frappe.ui.form.on("POS Invoice", "paid_amount", (frm) => {
		// Find the payment instance
		if (window.cur_pos && window.cur_pos.payment) {
			setTimeout(() => {
				attach_one_tap_handler(window.cur_pos.payment);
			}, 100);
		}
	});
	
	// Mark as patched
	erpnext.PointOfSale.Payment.prototype._patched_for_one_tap_allocation = true;
	
	console.log("✅ POS Payment patched for one-tap payment method allocation");
}

