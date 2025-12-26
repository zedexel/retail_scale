import frappe
from frappe import _
from frappe.utils.password import get_decrypted_password


@frappe.whitelist()
def validate_pos_removal_password(entered_password):
	"""
	Validate the password entered by user for POS item removal.
	Compares the entered password with the pos_key field from Retail Settings singleton doctype.
	
	:param entered_password: The password entered by the user
	:return: dict with 'success' (bool) and 'message' (str) keys
	"""
	if not entered_password:
		return {
			"success": False,
			"message": _("Password is required")
		}
	
	try:
		# Get the stored password from Retail Settings singleton doctype
		# Password fields are stored encrypted in __Auth table
		stored_password = get_decrypted_password(
			doctype="Retail Settings",
			name="Retail Settings",
			fieldname="pos_key",
			raise_exception=False
		)
		
		if not stored_password:
			return {
				"success": False,
				"message": _("POS removal password is not configured. Please contact administrator.")
			}
		
		# Compare passwords (case-sensitive)
		if entered_password == stored_password:
			return {
				"success": True,
				"message": _("Password verified successfully")
			}
		else:
			return {
				"success": False,
				"message": _("Incorrect password. Please try again.")
			}
			
	except Exception as e:
		frappe.log_error(
			title="POS Removal Password Validation Error",
			message=frappe.get_traceback()
		)
		return {
			"success": False,
			"message": _("An error occurred while validating password. Please try again.")
		}

