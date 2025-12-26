import frappe
import os
from frappe.utils.nestedset import get_descendants_of

def get_plu_group():
    """Get the PLU group from Retail Settings singleton doctype"""
    try:
        retail_settings = frappe.get_single("Retail Settings")
        return retail_settings.get("plu_group")
    except Exception as e:
        frappe.logger().error(f"PLU Export: Error getting plu_group from Retail Settings: {str(e)}")
        return None

def get_plu_item_groups():
    """Get the parent group and all its descendant groups"""
    plu_group = get_plu_group()
    if not plu_group:
        return []
    
    # Get parent group and all descendants
    all_groups = [plu_group]
    try:
        descendants = get_descendants_of("Item Group", plu_group)
        all_groups.extend(descendants)
    except Exception as e:
        frappe.logger().error(f"PLU Export: Error getting descendants of {plu_group}: {str(e)}")
    
    return all_groups

def get_plu_export_path():
    """Get the PLU export file path - fixed location in site's public folder"""
    return frappe.get_site_path("public", "PLU.txt")

def export_to_jhma(doc, method=None):
    try:
        # Debug logging
        frappe.logger().info(f"PLU Export: Hook triggered for {doc.doctype} - {doc.name}")
        
        # Get the PLU group and all its descendants
        plu_item_groups = get_plu_item_groups()
        if not plu_item_groups:
            frappe.logger().info(f"PLU Export: Skipping - no plu_group configured in Retail Settings")
            return
        
        # Check if this is an Item Price update
        if doc.doctype == "Item Price":
            # Check if it's for "Standard Selling" price list
            if doc.price_list != "Standard Selling":
                frappe.logger().info(f"PLU Export: Skipping - price list '{doc.price_list}' is not 'Standard Selling'")
                return
            
            # Check if the item belongs to the PLU group or any of its descendants
            item_group = frappe.db.get_value("Item", doc.item_code, "item_group")
            frappe.logger().info(f"PLU Export: Item {doc.item_code} belongs to group '{item_group}'")
            if item_group not in plu_item_groups:
                frappe.logger().info(f"PLU Export: Skipping - item group '{item_group}' not in PLU groups")
                return
        
        # For Item doctype, check if it belongs to the PLU group or any of its descendants
        elif doc.doctype == "Item":
            frappe.logger().info(f"PLU Export: Item {doc.name} belongs to group '{doc.item_group}'")
            if doc.item_group not in plu_item_groups:
                frappe.logger().info(f"PLU Export: Skipping - item group '{doc.item_group}' not in PLU groups")
                return
        else:
            frappe.logger().info(f"PLU Export: Skipping - wrong doctype: {doc.doctype}")
            return  # Skip for other doctypes
        
        # Export all items from the PLU group and its descendants
        plu_group = get_plu_group()
        frappe.logger().info(f"PLU Export: Starting export for group '{plu_group}' and its descendants")
        export_loose_items_to_plu()
        frappe.logger().info(f"PLU Export: Export completed successfully")
    except Exception as e:
        frappe.log_error(title="PLU Export Hook Error", message=frappe.get_traceback())
        frappe.logger().error(f"PLU Export Hook Error: {str(e)}")

def export_loose_items_to_plu():
    """Export all items from the PLU group and its descendants to PLU.txt file"""
    try:
        # Get the PLU group and all its descendants
        plu_item_groups = get_plu_item_groups()
        if not plu_item_groups:
            frappe.logger().warning(f"PLU Export: No PLU group configured in Retail Settings")
            return
        
        # Fetch all items from the PLU group and its descendants
        items = frappe.get_all("Item", 
            fields=["item_code", "item_name", "standard_rate", "custom_plu_code"],
            filters={"item_group": ["in", plu_item_groups], "disabled": 0},
            order_by="custom_plu_code asc") # Order by PLU code
        
        plu_group = get_plu_group()
        frappe.logger().info(f"PLU Export: Found {len(items)} items in group '{plu_group}' and its descendants")
        
        if not items:
            frappe.logger().warning(f"PLU Export: No items found in PLU group '{plu_group}' and its descendants")
            return
        
        lines = []
        current_date = frappe.utils.today()
        
        # Create the lines using custom_plu_code as PLU
        for item in items:
            # Skip items without a PLU code
            if not item.custom_plu_code:
                frappe.logger().warning(f"PLU Export: Skipping item {item.item_code} - no custom_plu_code set")
                continue
            
            name = item.item_name[:20] if item.item_name else ""
            
            # Get the latest Item Price for this item from "Standard Selling" price list
            # Try to get the most recent active Item Price
            # Build filters for valid Item Prices
            price_filters = {
                "item_code": item.item_code,
                "price_list": "Standard Selling",
                "selling": 1,
                "valid_from": ["<=", current_date]
            }
            
            # Get Item Prices that are either not expired or have no expiry
            item_prices = frappe.get_all(
                "Item Price",
                fields=["price_list_rate", "valid_upto"],
                filters=price_filters,
                order_by="valid_from desc, modified desc"
            )
            
            # Filter for valid prices (not expired)
            valid_prices = [
                ip for ip in item_prices 
                if not ip.valid_upto or ip.valid_upto >= current_date
            ]
            
            item_price = valid_prices[0].price_list_rate if valid_prices else None
            
            # Use Item Price if available, otherwise fallback to standard_rate
            price = item_price if item_price else (item.standard_rate or 0)
            
            # FORMAT: PLU,itemcode,name,price,unit
            # Result: 1,00001,Banana,45,0
            line = f"{item.custom_plu_code},{item.item_code},{name},{price},0"
            lines.append(line)
        
        # Get file path in site's public folder
        file_path = get_plu_export_path()
        
        # Ensure directory exists
        dir_path = os.path.dirname(file_path)
        if not os.path.exists(dir_path):
            try:
                os.makedirs(dir_path, exist_ok=True)
            except Exception as e:
                frappe.logger().error(f"PLU Export: Cannot create directory {dir_path}: {str(e)}")
                raise
        
        frappe.logger().info(f"PLU Export: Writing {len(lines)} lines to {file_path}")
        
        # Write the file
        with open(file_path, "w") as f:
            f.write("\n".join(lines))
        
        frappe.logger().info(f"PLU Export: Successfully wrote file to {file_path}")
        
    except Exception as e:
        error_msg = f"PLU Export Failed: {str(e)}\n{frappe.get_traceback()}"
        frappe.log_error(title="PLU Export Failed", message=error_msg)
        frappe.logger().error(error_msg)