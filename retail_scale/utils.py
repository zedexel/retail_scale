import frappe
import os

# Configure your item group name here
# Change "Loose" to your actual item group name
ITEM_GROUP_NAME = "Loose"  # Update this to match your item group name

# Configure PLU export file path
# Priority: Environment Variable > Site Config > Default
# For Docker on Windows 11, set environment variable: PLU_EXPORT_PATH=/path/in/container/PLU.txt
# Or mount a volume and use the mounted path
def get_plu_export_path():
    """Get the PLU export file path from config or environment"""
    # 1. Check environment variable (best for Docker)
    # Set PLU_EXPORT_PATH=/c/JHMA/PLU.txt or PLU_EXPORT_PATH=/workspace/JHMA/PLU.txt
    env_path = os.environ.get("PLU_EXPORT_PATH")
    if env_path:
        # Ensure it ends with PLU.txt if only directory is provided
        if env_path.endswith("/"):
            env_path = os.path.join(env_path, "PLU.txt")
        elif not env_path.endswith("PLU.txt"):
            # If path doesn't end with / or PLU.txt, assume it's a directory
            env_path = os.path.join(env_path, "PLU.txt")
        return env_path
    
    # 2. Check site config (frappe.conf or site_config.json)
    try:
        site_config = frappe.get_site_config()
        if site_config.get("plu_export_path"):
            config_path = site_config.get("plu_export_path")
            if config_path.endswith("/"):
                config_path = os.path.join(config_path, "PLU.txt")
            elif not config_path.endswith("PLU.txt"):
                config_path = os.path.join(config_path, "PLU.txt")
            return config_path
    except:
        pass
    
    # 3. Default paths (fallback)
    # For Linux/Ubuntu
    default_linux = "/home/aadi/Desktop/PLU.txt"
    # For Docker containers (common mount points)
    docker_paths = [
        "/c/JHMA/PLU.txt",  # WSL-style Windows C: drive mount
        "/workspace/JHMA/PLU.txt",  # Docker workspace mount
        "/workspace/PLU.txt",  # Common Docker workspace
        "/home/frappe/PLU.txt",  # Frappe Docker user home
        "/app/PLU.txt",  # Common app directory
    ]
    
    # Try to find a writable path
    for path in docker_paths + [default_linux]:
        try:
            # Check if directory exists and is writable
            dir_path = os.path.dirname(path)
            if os.path.exists(dir_path) and os.access(dir_path, os.W_OK):
                return path
        except:
            continue
    
    # Final fallback
    return default_linux

def export_to_jhma(doc, method=None):
    try:
        # Debug logging
        frappe.logger().info(f"PLU Export: Hook triggered for {doc.doctype} - {doc.name}")
        
        # Check if this is an Item Price update - if so, verify the item belongs to the configured group
        if doc.doctype == "Item Price":
            item_group = frappe.db.get_value("Item", doc.item_code, "item_group")
            frappe.logger().info(f"PLU Export: Item {doc.item_code} belongs to group '{item_group}', looking for '{ITEM_GROUP_NAME}'")
            if item_group != ITEM_GROUP_NAME:
                frappe.logger().info(f"PLU Export: Skipping - item group mismatch")
                return  # Skip if item doesn't belong to the configured group
        
        # For Item doctype, check if it belongs to the configured group
        elif doc.doctype == "Item":
            frappe.logger().info(f"PLU Export: Item {doc.name} belongs to group '{doc.item_group}', looking for '{ITEM_GROUP_NAME}'")
            if doc.item_group != ITEM_GROUP_NAME:
                frappe.logger().info(f"PLU Export: Skipping - item group mismatch")
                return  # Skip if not in the configured group
        else:
            frappe.logger().info(f"PLU Export: Skipping - wrong doctype: {doc.doctype}")
            return  # Skip for other doctypes
        
        # Export all items from the configured group
        frappe.logger().info(f"PLU Export: Starting export for group '{ITEM_GROUP_NAME}'")
        export_loose_items_to_plu()
        frappe.logger().info(f"PLU Export: Export completed successfully")
    except Exception as e:
        frappe.log_error(title="PLU Export Hook Error", message=frappe.get_traceback())
        frappe.logger().error(f"PLU Export Hook Error: {str(e)}")

def export_loose_items_to_plu():
    """Export all items from the configured item group to PLU.txt file"""
    try:
        # Fetch all items from the configured group
        items = frappe.get_all("Item", 
            fields=["item_code", "item_name", "standard_rate"],
            filters={"item_group": ITEM_GROUP_NAME, "disabled": 0},
            order_by="creation asc") # Keeps the list order consistent
        
        frappe.logger().info(f"PLU Export: Found {len(items)} items in group '{ITEM_GROUP_NAME}'")
        
        if not items:
            frappe.logger().warning(f"PLU Export: No items found in group '{ITEM_GROUP_NAME}'")
            return
        
        lines = []
        current_date = frappe.utils.today()
        
        # Create the lines with a sequential PLU (1, 2, 3...)
        for index, item in enumerate(items, start=1):
            name = item.item_name[:20] if item.item_name else ""
            
            # Get the latest Item Price for this item (prefer Item Price over standard_rate)
            # Try to get the most recent active Item Price
            # Build filters for valid Item Prices
            price_filters = {
                "item_code": item.item_code,
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
            line = f"{index},{item.item_code},{name},{price},0"
            lines.append(line)
        
        # Get configured file path (supports Docker/Windows)
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