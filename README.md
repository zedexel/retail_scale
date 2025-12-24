### Retail Scale

ERPNext POS Customisation for Weighing scale barcodes

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd frappe-bench
bench get-app https://github.com/zedexel/retail_scale.git --branch main
bench install-app retail_scale
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/retail_scale
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
