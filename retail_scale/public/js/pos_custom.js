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
		console.log("⏳ Waiting for POS ItemSelector to load...");
		setTimeout(patch_item_selector, 500);
		return;
	}
	
	// Check if already patched
	if (erpnext.PointOfSale.ItemSelector.prototype._patched_for_dynamic_barcode) {
		return;
	}
	
	const original_add_filtered = erpnext.PointOfSale.ItemSelector.prototype.add_filtered_item_to_cart;
	
	erpnext.PointOfSale.ItemSelector.prototype.add_filtered_item_to_cart = function() {
		// Check if the first item has a qty field from dynamic barcode
		if (this.items && this.items.length === 1 && this.items[0].qty) {
			const item = this.items[0];
			const scanned_qty = item.qty;
			
			// Check if item already exists in cart
			const frm = this.events.get_frm();
			const existing_item = frm.doc.items.find(row => 
				row.item_code === item.item_code && 
				(!item.batch_no || row.batch_no === item.batch_no) &&
				(!item.serial_no || row.serial_no === item.serial_no)
			);
			
			if (existing_item) {
				// Item exists - update quantity directly
				const current_qty = existing_item.qty || 0;
				const new_qty = current_qty + scanned_qty;
				
				console.log(`Dynamic barcode: Adding qty=${scanned_qty} (current: ${current_qty}, new total: ${new_qty})`);
				
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
				console.log(`Dynamic barcode: Adding new item with qty=${scanned_qty}`);
				
				this.events.item_selected({
					field: "qty",
					value: scanned_qty,
					item: {
						item_code: item.item_code,
						batch_no: item.batch_no,
						serial_no: item.serial_no,
						uom: item.uom,
						rate: item.price_list_rate,
						stock_uom: item.stock_uom
					}
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
	
	console.log("✅ POS ItemSelector patched for dynamic barcode quantities");
}

