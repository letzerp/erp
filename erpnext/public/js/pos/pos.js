// Copyright (c) 2013, Web Notes Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.pos");

erpnext.pos.PointOfSale = Class.extend({
	init: function(wrapper, frm) {
		this.wrapper = wrapper;
		this.frm = frm;
		this.wrapper.html(frappe.render_template("pos", {}));

		this.check_transaction_type();
		this.make();

		var me = this;
		$(this.frm.wrapper).on("refresh-fields", function() {
			me.refresh();
		});

		this.wrapper.find('input.discount-amount').on("change", function() {
			frappe.model.set_value(me.frm.doctype, me.frm.docname, "discount_amount", this.value);
		});
	},
	check_transaction_type: function() {
		var me = this;

		// Check whether the transaction is "Sales" or "Purchase"
		if (frappe.meta.has_field(cur_frm.doc.doctype, "customer")) {
			this.set_transaction_defaults("Customer", "export");
		}
		else if (frappe.meta.has_field(cur_frm.doc.doctype, "supplier")) {
			this.set_transaction_defaults("Supplier", "import");
		}
	},
	set_transaction_defaults: function(party, export_or_import) {
		var me = this;
		this.party = party;
		this.price_list = (party == "Customer" ?
			this.frm.doc.selling_price_list : this.frm.doc.buying_price_list);
		this.price_list_field = (party == "Customer" ? "selling_price_list" : "buying_price_list");
		this.sales_or_purchase = (party == "Customer" ? "Sales" : "Purchase");
		this.net_total = "net_total_" + export_or_import;
		this.grand_total = "grand_total_" + export_or_import;
		// this.amount = export_or_import + "_amount";
		// this.rate = export_or_import + "_rate";
	},
	make: function() {
		this.make_party();
		this.make_search();
		this.make_item_list();
	},
	make_party: function() {
		var me = this;
		this.party_field = frappe.ui.form.make_control({
			df: {
				"fieldtype": "Link",
				"options": this.party,
				"label": this.party,
				"fieldname": "pos_party",
				"placeholder": this.party
			},
			parent: this.wrapper.find(".party-area"),
			only_input: true,
		});
		this.party_field.make_input();
		this.party_field.$input.on("change", function() {
			if(!me.party_field.autocomplete_open)
				frappe.model.set_value(me.frm.doctype, me.frm.docname,
					me.party.toLowerCase(), this.value);
		});
	},
	make_search: function() {
		var me = this;
		this.search = frappe.ui.form.make_control({
			df: {
				"fieldtype": "Data",
				"label": "Item",
				"fieldname": "pos_item",
				"placeholder": "Search Item"
			},
			parent: this.wrapper.find(".search-area"),
			only_input: true,
		});
		this.search.make_input();
		this.search.$input.on("keypress", function() {
			if(!me.search.autocomplete_open)
				if(me.item_timeout)
					clearTimeout(me.item_timeout);
				me.item_timeout = setTimeout(function() { me.make_item_list(); }, 1000);
		});
	},
	make_item_list: function() {
		var me = this;
		if(!this.price_list) {
			msgprint(__("Price List not found or disabled"));
			return;
		}

		me.item_timeout = null;
		frappe.call({
			method: 'erpnext.accounts.doctype.sales_invoice.pos.get_items',
			args: {
				sales_or_purchase: this.sales_or_purchase,
				price_list: this.price_list,
				item: this.search.$input.val()
			},
			callback: function(r) {
				var $wrap = me.wrapper.find(".item-list");
				me.wrapper.find(".item-list").empty();
				if (r.message) {
					if (r.message.length === 1) {
						var item = r.message[0];
						if (item.serial_no) {
							me.add_to_cart(item.item_code, item.serial_no);
							this.search.$input.val("");
							return;

						} else if (item.barcode) {
							me.add_to_cart(item.item_code);
							this.search.$input.val("");
							return;
						}
					}

					$.each(r.message, function(index, obj) {
						$(frappe.render_template("pos_item", {
							item_code: obj.name,
							item_price: format_currency(obj.price_list_rate, obj.currency),
							item_name: obj.name===obj.item_name ? "" : obj.item_name,
							item_image: obj.image ? "url('" + obj.image + "')" : null
						})).tooltip().appendTo($wrap);
					});
				}

				// if form is local then allow this function
				$(me.wrapper).find("div.pos-item").on("click", function() {
					if(me.frm.doc.docstatus==0) {
						me.add_to_cart($(this).attr("data-item-code"));
					}
				});
			}
		});
	},
	add_to_cart: function(item_code, serial_no) {
		var me = this;
		var caught = false;

		if(!me.frm.doc[me.party.toLowerCase()] && ((me.frm.doctype == "Quotation" &&
				me.frm.doc.quotation_to == "Customer")
				|| me.frm.doctype != "Quotation")) {
			msgprint(__("Please select {0} first.", [me.party]));
			return;
		}

		// get no_of_items
		var no_of_items = me.wrapper.find(".pos-bill-item").length;

		// check whether the item is already added
		if (no_of_items != 0) {
			$.each(this.frm.doc["items"] || [], function(i, d) {
				if (d.item_code == item_code) {
					caught = true;
					if (serial_no)
						frappe.model.set_value(d.doctype, d.name, "serial_no", d.serial_no + '\n' + serial_no);
					else
						frappe.model.set_value(d.doctype, d.name, "qty", d.qty + 1);
				}
			});
		}

		// if item not found then add new item
		if (!caught)
			this.add_new_item_to_grid(item_code, serial_no);

		this.refresh();
		this.refresh_search_box();
	},
	add_new_item_to_grid: function(item_code, serial_no) {
		var me = this;

		var child = frappe.model.add_child(me.frm.doc, this.frm.doctype + " Item", "items");
		child.item_code = item_code;
		child.qty = 1;

		if (serial_no)
			child.serial_no = serial_no;

		this.frm.script_manager.trigger("item_code", child.doctype, child.name);
	},
	refresh_search_box: function() {
		var me = this;

		// Clear Item Box and remake item list
		if (this.search.$input.val()) {
			this.search.set_input("");
			this.make_item_list();
		}
	},
	update_qty: function(item_code, qty) {
		var me = this;
		$.each(this.frm.doc["items"] || [], function(i, d) {
			if (d.item_code == item_code) {
				if (qty == 0) {
					frappe.model.clear_doc(d.doctype, d.name);
					me.refresh_grid();
				} else {
					frappe.model.set_value(d.doctype, d.name, "qty", qty);
				}
			}
		});
		this.refresh();
	},
	refresh: function() {
		var me = this;

		this.refresh_item_list();
		this.refresh_fields();

		// if form is local then only run all these functions
		if (this.frm.doc.docstatus===0) {
			this.call_when_local();
		}

		this.disable_text_box_and_button();
		this.set_primary_action();

		// If quotation to is not Customer then remove party
		if (this.frm.doctype == "Quotation" && this.frm.doc.quotation_to!="Customer") {
			this.party_field.$input.prop("disabled", true);
		}
	},
	refresh_fields: function() {
		this.party_field.set_input(this.frm.doc[this.party.toLowerCase()]);
		this.wrapper.find('input.discount-amount').val(this.frm.doc.discount_amount);

		this.show_items_in_item_cart();
		this.show_taxes();
		this.set_totals();
	},
	refresh_item_list: function() {
		var me = this;
		// refresh item list on change of price list
		if (this.frm.doc[this.price_list_field] != this.price_list) {
			this.price_list = this.frm.doc[this.price_list_field];
			this.make_item_list();
		}
	},
	show_items_in_item_cart: function() {
		var me = this;
		var $items = this.wrapper.find(".items").empty();

		$.each(this.frm.doc.items|| [], function(i, d) {
			$(frappe.render_template("pos_bill_item", {
				item_code: d.item_code,
				item_name: (d.item_name===d.item_code || !d.item_name) ? "" : ("<br>" + d.item_name),
				qty: d.qty,
				rate: format_currency(d.rate, me.frm.doc.currency),
				amount: format_currency(d.amount, me.frm.doc.currency)
			})).appendTo($items);
		});

		this.wrapper.find("input.pos-item-qty").on("focus", function() {
			$(this).select();
		});
	},
	show_taxes: function() {
		var me = this;
		var taxes = this.frm.doc["taxes"] || [];
		$(this.wrapper)
			.find(".tax-area").toggleClass("hide", (taxes && taxes.length) ? false : true)
			.find(".tax-table").empty();

		$.each(taxes, function(i, d) {
			if (d.tax_amount) {
				$(frappe.render_template("pos_tax_row", {
					description: d.description,
					tax_amount: format_currency(flt(d.tax_amount)/flt(me.frm.doc.conversion_rate),
						me.frm.doc.currency)
				})).appendTo(me.wrapper.find(".tax-table"));
			}
		});
	},
	set_totals: function() {
		var me = this;
		this.wrapper.find(".net-total").text(format_currency(this.frm.doc[this.net_total],
			me.frm.doc.currency));
		this.wrapper.find(".grand-total").text(format_currency(this.frm.doc[this.grand_total],
			me.frm.doc.currency));
	},
	call_when_local: function() {
		var me = this;

		// append quantity to the respective item after change from input box
		$(this.wrapper).find("input.pos-item-qty").on("change", function() {
			var item_code = $(this).parents(".pos-bill-item").attr("data-item-code");
			me.update_qty(item_code, $(this).val());
		});

		// increase/decrease qty on plus/minus button
		$(this.wrapper).find(".pos-qty-btn").on("click", function() {
			var $item = $(this).parents(".pos-bill-item:first");
			me.increase_decrease_qty($item, $(this).attr("data-action"));
		});

		this.focus();
	},
	focus: function() {
		if(this.frm.doc[this.party.toLowerCase()]) {
			this.search.$input.focus();
		} else {
			if(!(this.frm.doctype == "Quotation" && this.frm.doc.quotation_to!="Customer"))
				this.party_field.$input.focus();
		}
	},
	increase_decrease_qty: function($item, operation) {
		var item_code = $item.attr("data-item-code");
		var item_qty = cint($item.find("input.pos-item-qty").val());

		if (operation == "increase-qty")
			this.update_qty(item_code, item_qty + 1);
		else if (operation == "decrease-qty" && item_qty != 0)
			this.update_qty(item_code, item_qty - 1);
	},
	disable_text_box_and_button: function() {
		var me = this;
		// if form is submitted & cancelled then disable all input box & buttons
		$(this.wrapper)
			.find(".pos-qty-btn")
			.toggle(this.frm.doc.docstatus===0);

		$(this.wrapper).find('input, button').prop("disabled", !(this.frm.doc.docstatus===0));

		this.wrapper.find(".pos-item-area").toggleClass("hide", me.frm.doc.docstatus!==0);

	},
	set_primary_action: function() {
		var me = this;
		if (!this.frm.pos_active) return;

		if (this.frm.doctype == "Sales Invoice" && this.frm.doc.docstatus===0) {
			if (!this.frm.doc.is_pos) {
				this.frm.set_value("is_pos", 1);
			}
			this.frm.page.clear_actions();
			this.frm.page.set_primary_action(__("Pay"), function() {
				me.make_payment();
			});
			this.frm.toolbar.current_status = null;
		} else if (this.frm.doc.docstatus===1) {
			this.frm.page.clear_actions();
			this.frm.page.set_primary_action(__("New"), function() {
				me.frm.pos_active = false;
				erpnext.open_as_pos = true;
				new_doc(me.frm.doctype);
			});
			this.frm.toolbar.current_status = null;
		}
	},
	refresh_delete_btn: function() {
		$(this.wrapper).find(".remove-items").toggle($(".item-cart .warning").length ? true : false);
	},
	remove_selected_items: function() {
		var me = this;
		var selected_items = [];
		var no_of_items = $(this.wrapper).find("#cart tbody tr").length;
		for(var x=0; x<=no_of_items - 1; x++) {
			var row = $(this.wrapper).find("#cart tbody tr:eq(" + x + ")");
			if(row.attr("data-selected") == "true") {
				selected_items.push(row.attr("id"));
			}
		}

		var child = this.frm.doc["items"] || [];

		$.each(child, function(i, d) {
			for (var i in selected_items) {
				if (d.item_code == selected_items[i]) {
					frappe.model.clear_doc(d.doctype, d.name);
				}
			}
		});

		this.refresh_grid();
	},
	refresh_grid: function() {
		this.frm.dirty();
		this.frm.fields_dict["items"].grid.refresh();
		this.frm.script_manager.trigger("calculate_taxes_and_totals");
		this.refresh();
	},
	make_payment: function() {
		var me = this;
		var no_of_items = this.frm.doc.items.length;

		if (no_of_items == 0)
			msgprint(__("Payment cannot be made for empty cart"));
		else {
			frappe.call({
				method: 'erpnext.accounts.doctype.sales_invoice.pos.get_mode_of_payment',
				callback: function(r) {
					if(!r.message) {
						msgprint(__("Please add to Modes of Payment from Setup."))
						return;
					}

					var modes_of_payment = r.message;

					// prefer cash payment!
					var default_mode = modes_of_payment.indexOf(__("Cash"))!==-1 ? __("Cash") : undefined;

					// show payment wizard
					var dialog = new frappe.ui.Dialog({
						width: 400,
						title: 'Payment',
						fields: [
							{fieldtype:'Currency', fieldname:'total_amount', label: __('Total Amount'), read_only:1,
								options:"currency", default:me.frm.doc.grand_total_export, read_only: 1},
							{fieldtype:'Select', fieldname:'mode_of_payment', label: __('Mode of Payment'),
								options:modes_of_payment.join('\n'), reqd: 1, default: default_mode},
							{fieldtype:'Currency', fieldname:'paid_amount', label:__('Amount Paid'), reqd:1,
								options: "currency",
								default:me.frm.doc.grand_total_export, hidden: 1},
							{fieldtype:'Currency', fieldname:'change', label: __('Change'), options: "currency",
								default: 0.0, hidden: 1},
							{fieldtype:'Currency', fieldname:'write_off_amount', label: __('Write Off'), options: "currency",
								default: 0.0, hidden: 1},
							{fieldtype:'Button', fieldname:'pay', label:'Pay'}
						]
					});
					dialog.show();

					// make read only
					dialog.get_input("total_amount").prop("disabled", true);
					dialog.get_input("write_off_amount").prop("disabled", true);

					dialog.get_input("paid_amount").on("change", function() {
						var values = dialog.get_values();
						dialog.set_value("change", Math.round(values.paid_amount - values.total_amount));
						dialog.get_input("change").trigger("change");
					});

					dialog.get_input("change").on("change", function() {
						var values = dialog.get_values();
						var write_off_amount = (flt(values.paid_amount) - flt(values.change)) - values.total_amount;
						dialog.set_value("write_off_amount", write_off_amount);
						dialog.fields_dict.write_off_amount.$wrapper.toggleClass("hide", !!!write_off_amount);
					});

					// toggle amount paid and change
					dialog.get_input("mode_of_payment").on("change", function() {
						var is_cash = dialog.get_value("mode_of_payment") === __("Cash");
						dialog.fields_dict.paid_amount.$wrapper.toggleClass("hide", !is_cash);
						dialog.fields_dict.change.$wrapper.toggleClass("hide", !is_cash);

						if (is_cash && !dialog.get_value("change")) {
							// set to nearest 5
							var paid_amount = 5 * Math.ceil(dialog.get_value("total_amount") / 5);
							dialog.set_value("paid_amount", paid_amount);
							dialog.get_input("paid_amount").trigger("change");
						}
					}).trigger("change");

					dialog.fields_dict.pay.input.onclick = function() {
						var values = dialog.get_values();
						var is_cash = values.mode_of_payment === __("Cash");
						if (!is_cash) {
							values.write_off_amount = values.change = 0.0;
							values.paid_amount = values.total_amount;
						}
						me.frm.set_value("mode_of_payment", values.mode_of_payment);

						var paid_amount = flt((flt(values.paid_amount) - flt(values.change)) / me.frm.doc.conversion_rate, precision("paid_amount"));
						me.frm.set_value("paid_amount", paid_amount);

						// specifying writeoff amount here itself, so as to avoid recursion issue
						me.frm.set_value("write_off_amount", me.frm.doc.grand_total - paid_amount);
						me.frm.set_value("outstanding_amount", 0);

						me.frm.savesubmit(this);
						dialog.hide();
						me.refresh();
					};
				}
			});
		}
	},
});

erpnext.pos.make_pos_btn = function(frm) {
	// Show POS button only if it is enabled from features setup
	if (cint(sys_defaults.fs_pos_view)!==1 || frm.doctype==="Material Request") {
		return;
	}

	if(frm.doc.docstatus <= 1) {
		if(!frm.pos_active) {
			var btn_label = __("POS View"),
				icon = "icon-th";
		} else {
			var btn_label = __("Form View"),
				icon = "icon-file-text";
		}

		if(erpnext.open_as_pos) {
			erpnext.pos.toggle(frm, true);
			erpnext.open_as_pos = false;
		}

		frm.$pos_btn && frm.$pos_btn.remove();

		frm.$pos_btn = frm.page.add_menu_item(btn_label, function() {
			erpnext.pos.toggle(frm);
		});
	} else {
		// hack: will avoid calling refresh from refresh
		setTimeout(function() { erpnext.pos.toggle(frm, false); }, 100);
	}
}

erpnext.pos.toggle = function(frm, show) {
	// Check whether it is Selling or Buying cycle
	var price_list = frappe.meta.has_field(cur_frm.doc.doctype, "selling_price_list") ?
		frm.doc.selling_price_list : frm.doc.buying_price_list;

	if((show===true && frm.pos_active) || (show===false && !frm.pos_active)) {
		return;
	}

	if(show && !price_list) {
		frappe.throw(__("Please select Price List"));
	}

	// make pos
	if(!frm.pos) {
		var wrapper = frm.page.add_view("pos", "<div>");
		frm.pos = new erpnext.pos.PointOfSale(wrapper, frm);
	}

	// toggle view
	frm.page.set_view(frm.pos_active ? "main" : "pos");
	frm.pos_active = !frm.pos_active;

	frm.refresh();

	// refresh
	if(frm.pos_active) {
		frm.pos.refresh();
	}
}
