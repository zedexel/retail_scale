import frappe
from frappe import _
from frappe.utils import flt

from erpnext.controllers.sales_and_purchase_return import get_returned_qty_map_for_row

# frappe.utils.logger.set_log_level("DEBUG")
# logger = frappe.logger("retail_scale.overrides.pos_return_utils", allow_site=True, file_count=50)


@frappe.whitelist()
def get_return_against_items(return_against, exclude_return_invoice=None):
	"""
	Get items from original POS Invoice with barcode and quantity information.
	Includes already-returned quantities for validation.
	
	Args:
		return_against: Name of the original POS Invoice
		exclude_return_invoice: Optional name of return invoice to exclude from calculation
		
	Returns:
		List of items with barcode, quantity, and available return quantities
	"""
	if not return_against:
		frappe.throw(_("Return Against invoice is required"))
	
	# Get original invoice
	original_invoice = frappe.get_doc("POS Invoice", return_against)
	
	# Get customer for returned qty calculation
	customer = original_invoice.customer
	
	# First, get all return invoices against this original invoice
	return_invoices = frappe.get_all(
		"POS Invoice",
		fields=["name", "docstatus", "is_return", "customer"],
		filters={
			"return_against": return_against,
			"is_return": 1,
			"customer": customer,
		},
		order_by="creation desc"
	)
	
	# logger.debug(f"🔍 Found {len(return_invoices)} return invoice(s) against {return_against}:")
	for ret_inv in return_invoices:
		excluded_note = " (EXCLUDED)" if exclude_return_invoice and ret_inv.name == exclude_return_invoice else ""
		# logger.debug(f"  - {ret_inv.name} (docstatus: {ret_inv.docstatus}, customer: {ret_inv.customer}){excluded_note}")
	
	items = []
	
	# Get all items from original invoice
	for item in original_invoice.items:
		# Get already returned quantities for this item row
		# If exclude_return_invoice is provided, manually calculate excluding that invoice
		if exclude_return_invoice:
			# Manually calculate returned quantities excluding the specified return invoice
			from frappe.query_builder import functions as fn
			from frappe.query_builder import DocType
			
			pos_invoice = DocType("POS Invoice")
			pos_invoice_item = DocType("POS Invoice Item")
			
			# First, get detailed breakdown of return invoices for this item
			detail_query = (
				frappe.qb.from_(pos_invoice)
				.join(pos_invoice_item).on(pos_invoice.name == pos_invoice_item.parent)
				.select(
					pos_invoice.name.as_("return_invoice"),
					pos_invoice.docstatus,
					fn.Abs(pos_invoice_item.qty).as_("qty"),
					fn.Abs(pos_invoice_item.stock_qty).as_("stock_qty")
				)
				.where(
					(pos_invoice.return_against == return_against)
					& (pos_invoice.customer == customer)
					& (pos_invoice.docstatus == 1)
					& (pos_invoice.is_return == 1)
					& (pos_invoice_item.pos_invoice_item == item.name)
					& (pos_invoice.name != exclude_return_invoice)
				)
			)
			
			detail_results = detail_query.run(as_dict=True)
			# logger.debug(f"  📦 Item {item.item_code} (row: {item.name}):")
			# logger.debug(f"    Found {len(detail_results)} return invoice(s) with this item:")
			total_qty = 0
			total_stock_qty = 0
			for detail in detail_results:
				# logger.debug(f"      - {detail.return_invoice}: qty={detail.qty}, stock_qty={detail.stock_qty} (docstatus: {detail.docstatus})")
				total_qty += detail.qty
				total_stock_qty += detail.stock_qty
			# logger.debug(f"    Total returned: qty={total_qty}, stock_qty={total_stock_qty}")
			
			# Now get aggregated totals
			query = (
				frappe.qb.from_(pos_invoice)
				.join(pos_invoice_item).on(pos_invoice.name == pos_invoice_item.parent)
				.select(
					fn.Sum(fn.Abs(pos_invoice_item.qty)).as_("qty"),
					fn.Sum(fn.Abs(pos_invoice_item.stock_qty)).as_("stock_qty")
				)
				.where(
					(pos_invoice.return_against == return_against)
					& (pos_invoice.customer == customer)
					& (pos_invoice.docstatus == 1)
					& (pos_invoice.is_return == 1)
					& (pos_invoice_item.pos_invoice_item == item.name)
					& (pos_invoice.name != exclude_return_invoice)
				)
			)
			
			result = query.run(as_dict=True)
			returned_qty_map = result[0] if result else {}
		else:
			# Use standard function, but also log details
			from frappe.query_builder import functions as fn
			from frappe.query_builder import DocType
			
			pos_invoice = DocType("POS Invoice")
			pos_invoice_item = DocType("POS Invoice Item")
			
			# Get detailed breakdown
			detail_query = (
				frappe.qb.from_(pos_invoice)
				.join(pos_invoice_item).on(pos_invoice.name == pos_invoice_item.parent)
				.select(
					pos_invoice.name.as_("return_invoice"),
					pos_invoice.docstatus,
					fn.Abs(pos_invoice_item.qty).as_("qty"),
					fn.Abs(pos_invoice_item.stock_qty).as_("stock_qty")
				)
				.where(
					(pos_invoice.return_against == return_against)
					& (pos_invoice.customer == customer)
					& (pos_invoice.docstatus == 1)
					& (pos_invoice.is_return == 1)
					& (pos_invoice_item.pos_invoice_item == item.name)
				)
			)
			
			detail_results = detail_query.run(as_dict=True)
			# logger.debug(f"  📦 Item {item.item_code} (row: {item.name}):")
			# logger.debug(f"    Found {len(detail_results)} return invoice(s) with this item:")
			total_qty = 0
			total_stock_qty = 0
			for detail in detail_results:
				# logger.debug(f"      - {detail.return_invoice}: qty={detail.qty}, stock_qty={detail.stock_qty} (docstatus: {detail.docstatus})")
				total_qty += detail.qty
				total_stock_qty += detail.stock_qty
			# logger.debug(f"    Total returned: qty={total_qty}, stock_qty={total_stock_qty}")
			
			# Use standard function for aggregated result
			returned_qty_map = get_returned_qty_map_for_row(
				return_against,
				customer,
				item.name,
				"POS Invoice"
			) or {}
		
		# Calculate available quantities
		original_qty = flt(item.qty)
		original_stock_qty = flt(item.stock_qty)
		returned_qty = flt(returned_qty_map.get("qty") or 0)
		returned_stock_qty = flt(returned_qty_map.get("stock_qty") or 0)
		
		available_qty = original_qty - returned_qty
		available_stock_qty = original_stock_qty - returned_stock_qty
		
		item_data = {
			"item_code": item.item_code,
			"barcode": item.barcode or "",
			"qty": original_qty,
			"stock_qty": original_stock_qty,
			"pos_invoice_item": item.name,
			"available_qty": available_qty,
			"available_stock_qty": available_stock_qty,
			"batch_no": item.batch_no or "",
			"serial_no": item.serial_no or "",
			"rate": item.rate,
			"uom": item.uom,
			"stock_uom": item.stock_uom,
			"conversion_factor": item.conversion_factor,
		}
		
		items.append(item_data)
	
	return items

