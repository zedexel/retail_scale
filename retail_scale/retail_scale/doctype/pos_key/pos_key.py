# Copyright (c) 2024, Retail Scale and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class POSKey(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		description: DF.SmallText | None
		disabled: DF.Check
		password: DF.Data | None
	# end: auto-generated types

	pass

