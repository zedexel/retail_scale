import frappe
from erpnext.stock.utils import scan_barcode as original_scan_barcode
from erpnext.selling.page.point_of_sale.point_of_sale import search_by_term as _original_search_by_term

# frappe.utils.logger.set_log_level("DEBUG")
# logger = frappe.logger("retail_scale.overrides.barcode_utils", allow_site=True, file_count=50)

@frappe.whitelist()
def custom_scan_barcode(search_value: str, ctx: dict | str | None = None):
    """
    Custom barcode scanner that handles dynamic barcodes with embedded weight
    Format: [PREFIX][ITEM_CODE][WEIGHT]
    Example: 21-12345-00500 (prefix=21, item_code=12345, weight=500g)
    """
    
    # Log the incoming barcode
    # logger.debug(f"🔍 Custom Barcode Scanner - Received: {search_value}")
    # logger.debug(f"🔍 Barcode length: {len(search_value)}, Starts with 21: {search_value.startswith('21')}")
    
    # Check if this is a dynamic barcode with your prefix
    if search_value.startswith("21") and len(search_value) == 12:
        # logger.debug(f"✅ Dynamic barcode detected! Processing...")
        
        try:
            prefix = search_value[0:2]  # "21"
            item_code = search_value[2:7]  # 5 digits
            weight_str = search_value[7:12]  # 5 digits
            
            # logger.debug(f"📊 Parsed - Prefix: {prefix}, Item Code: {item_code}, Weight String: {weight_str}")
            
            # Convert weight (assuming it's in grams, last 5 digits)
            weight_kg = float(weight_str) / 1000  # Convert grams to kg
            # logger.debug(f"⚖️  Weight converted: {weight_str}g = {weight_kg}kg")
            
            # Store qty in thread-local for use by search_by_term
            frappe.local.dynamic_barcode_qty = weight_kg
            
            # Lookup the item by the embedded item code
            # You might need to pad or format the item_code based on your naming
            # For example, if your items are named "ITEM-00001", adjust accordingly
            item_exists = frappe.db.exists("Item", item_code)
            # logger.debug(f"🔎 Item lookup - Code: {item_code}, Exists: {item_exists}")

            if item_exists:
                # Return the item with the scanned weight as quantity
                result = {
                    "item_code": item_code,
                    "qty": weight_kg,  # Set quantity to the scanned weight
                    "barcode": search_value,  # Keep original barcode for reference
                }
                
                # logger.debug(f"✅ Returning result: {result}")
                
                # Get item debug (batch/serial flags)
                from erpnext.stock.utils import _update_item_info
                _update_item_info(result, frappe.parse_json(ctx) if ctx else None)
                
                # logger.debug(f"✅ Final result after _update_item_info: {result}")
                return result
            # else:
            #     logger.warning(f"⚠️  Item not found: {item_code}. Falling back to standard lookup.")
                
        except (ValueError, IndexError) as e:
            # If parsing fails, fall back to standard barcode lookup
            # logger.error(f"❌ Failed to parse dynamic barcode: {search_value} - Error: {str(e)}")
            frappe.log_error(f"Failed to parse dynamic barcode: {search_value}\nError: {str(e)}", "Custom Barcode Scanner")
    # else:
    #     logger.debug(f"ℹ️  Not a dynamic barcode. Falling back to standard scan_barcode.")
    
    # Clear any stored qty for standard barcodes
    frappe.local.dynamic_barcode_qty = None
    
    # Fall back to the original scan_barcode function for standard barcodes
    result = original_scan_barcode(search_value, ctx)
    # logger.debug(f"🔙 Standard barcode result: {result}")
    return result


def custom_search_by_term(search_term, warehouse, price_list):
    """Wrapper that preserves qty from dynamic barcode scanning"""
    # Call the ORIGINAL saved function (not the patched one - avoids recursion)
    result = _original_search_by_term(search_term, warehouse, price_list)
    
    # Check if we have a dynamic barcode qty stored
    qty = getattr(frappe.local, 'dynamic_barcode_qty', None)
    
    if qty and result and result.get("items"):
        # Add qty field to each item
        for item in result["items"]:
            item["qty"] = qty
        # logger.debug(f"✅ Added qty={qty} to item in search result")
        
        # Clear after use
        frappe.local.dynamic_barcode_qty = None
    
    return result


def patch_scan_barcode_imports():
    """
    Monkey patch scan_barcode at the module level to intercept internal Python calls.
    This runs before each request to ensure the override is always active.
    """
    import erpnext.stock.utils
    import erpnext.selling.page.point_of_sale.point_of_sale as pos_module
    
    # Replace in both modules
    erpnext.stock.utils.scan_barcode = custom_scan_barcode
    pos_module.scan_barcode = custom_scan_barcode
    pos_module.search_by_term = custom_search_by_term
    
    # logger.debug("🔧 Barcode scan function patched successfully!")