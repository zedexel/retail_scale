app_name = "retail_scale"
app_title = "Retail Scale"
app_publisher = "ZedeXeL"
app_description = "ERPNext POS Customisation for Weighing scale barcodes"
app_email = "zedexeltech@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "retail_scale",
# 		"logo": "/assets/retail_scale/logo.png",
# 		"title": "Retail Scale",
# 		"route": "/retail_scale",
# 		"has_permission": "retail_scale.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/retail_scale/css/retail_scale.css"
# app_include_js = "/assets/retail_scale/js/retail_scale.js"

# include js, css files in header of web template
# web_include_css = "/assets/retail_scale/css/retail_scale.css"
# web_include_js = "/assets/retail_scale/js/retail_scale.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "retail_scale/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
page_js = {"point-of-sale": "public/js/pos_custom.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "retail_scale/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "retail_scale.utils.jinja_methods",
# 	"filters": "retail_scale.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "retail_scale.install.before_install"
# after_install = "retail_scale.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "retail_scale.uninstall.before_uninstall"
# after_uninstall = "retail_scale.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "retail_scale.utils.before_app_install"
# after_app_install = "retail_scale.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "retail_scale.utils.before_app_uninstall"
# after_app_uninstall = "retail_scale.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "retail_scale.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"retail_scale.tasks.all"
# 	],
# 	"daily": [
# 		"retail_scale.tasks.daily"
# 	],
# 	"hourly": [
# 		"retail_scale.tasks.hourly"
# 	],
# 	"weekly": [
# 		"retail_scale.tasks.weekly"
# 	],
# 	"monthly": [
# 		"retail_scale.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "retail_scale.install.before_tests"

# Overriding Methods
# ------------------------------
#
override_whitelisted_methods = {
	"erpnext.selling.page.point_of_sale.point_of_sale.search_for_serial_or_batch_or_barcode_number": "retail_scale.overrides.barcode_utils.custom_scan_barcode",
	"erpnext.accounts.doctype.pos_invoice.pos_invoice.get_return_against_items": "retail_scale.overrides.pos_return_utils.get_return_against_items"
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "retail_scale.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
before_request = ["retail_scale.overrides.barcode_utils.patch_scan_barcode_imports"]
# after_request = ["retail_scale.utils.after_request"]

# Job Events
# ----------
# before_job = ["retail_scale.utils.before_job"]
# after_job = ["retail_scale.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"retail_scale.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

