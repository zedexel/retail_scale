"""
Create custom field 'is_home_delivery' for POS Invoice
"""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
	"""Create is_home_delivery custom field for POS Invoice"""
	
	# Check if field already exists
	if frappe.db.exists("Custom Field", {"dt": "POS Invoice", "fieldname": "is_home_delivery"}):
		print("Custom field 'is_home_delivery' already exists for POS Invoice")
		return
	
	# Create the custom field
	df = {
		"fieldname": "is_home_delivery",
		"label": "Home Delivery",
		"fieldtype": "Check",
		"default": "0",
		"insert_after": "is_return",
		"description": "Check if this is a home delivery order",
		"in_list_view": 1,
		"in_standard_filter": 1,
		"print_hide": 0,
		"read_only": 0,
		"reqd": 0,
	}
	
	try:
		create_custom_field("POS Invoice", df, ignore_validate=True)
		print("✅ Created custom field 'is_home_delivery' for POS Invoice")
		
		# Update database schema
		frappe.db.updatedb("POS Invoice")
		print("✅ Updated database schema for POS Invoice")
		
	except Exception as e:
		print(f"❌ Error creating custom field: {str(e)}")
		raise

