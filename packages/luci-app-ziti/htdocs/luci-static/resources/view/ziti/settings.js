// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require dom';

var callCheck = rpc.declare({
	object: 'ziti', method: 'check_update', expect: { }
});
var callUpgrade = rpc.declare({
	object: 'ziti', method: 'upgrade_zet', expect: { }
});

// Headings of the page stand out from the settings around them.
var HEADING_STYLE = 'color:var(--primary-color-high);border-bottom:1px solid var(--primary-color-high);padding-bottom:.25em';

var Heading = form.DummyValue.extend({
	render: function () {
		return E('h4', { 'style': HEADING_STYLE + ';margin:1.5em 0 .75em' }, this.title);
	}
});

// A section folded into a list that opens by click. Folding stores nothing.
var CollapsedSection = form.NamedSection.extend({
	render: function () {
		var summary = this.summary, open = this.open;
		return this.super('render', arguments).then(function (node) {
			return E('details', open ? { 'open': 'open' } : {}, [
				E('summary', { 'style': 'cursor:pointer;font-weight:bold;margin:1em 0;color:var(--primary-color-high)' }, summary),
				node
			]);
		});
	}
});

return view.extend({
	load: function () {
		return uci.load('ziti');
	},

	render: function () {
		var m, s, o;

		m = new form.Map('ziti', _('OpenZiti Settings'),
			_('Changes apply without a restart, except the upstream DNS server: clients lose connection briefly when it changes.'));

		// A display switch for one setting. Nothing is stored for the switch itself:
		// the field exists only while it is ticked, and unticking removes the value.
		function override(section, name, title, hint, makeField) {
			var t = section.option(form.Flag, '_override_' + name, title, hint);
			t.rmempty = false;
			t.cfgvalue = function (section_id) { return uci.get('ziti', section_id, name) != null ? '1' : '0'; };
			t.write = function () {};
			t.remove = function () {};
			var field = makeField(section, name);
			field.depends('_override_' + name, '1');
			field.rmempty = false;
			return field;
		}

		function number(min, placeholder, max) {
			return function (section, name) {
				var f = section.option(form.Value, name, ' ');
				f.datatype = max ? 'range(' + min + ',' + max + ')' : (min ? 'and(uinteger,min(' + min + '))' : 'uinteger');
				f.placeholder = placeholder;
				return f;
			};
		}

		function list(datatype, placeholder) {
			return function (section, name) {
				var f = section.option(form.DynamicList, name, ' ');
				f.datatype = datatype;
				f.placeholder = placeholder;
				return f;
			};
		}

		s = m.section(form.NamedSection, 'main', 'ziti', _('Main settings'));
		s.anonymous = true;

		o = s.option(form.ListValue, 'log_level', _('Log level'),
			_('Log detail level for the tunnel. Info suits normal use. Default: Info.'));
		o.value('ERROR', 'Error'); o.value('WARN', 'Warning'); o.value('INFO', 'Info');
		o.value('DEBUG', 'Debug'); o.value('VERBOSE', 'Verbose'); o.value('TRACE', 'Trace');
		o.default = 'INFO';

		var ws = m.section(form.NamedSection, 'main', 'ziti', _('Resilience watchdog'),
			_('Checks the tunnel on its own. While it is broken, traffic goes around the tunnel, and the tunnel keeps trying to reconnect. When it recovers, traffic returns.'));
		ws.anonymous = true;

		o = ws.option(form.Flag, 'watchdog_enabled', _('Enable watchdog'),
			_('If unchecked, the tunnel is not checked, and its services are unavailable while it is broken.'));
		o.default = '1';
		o.rmempty = false;

		o = ws.option(form.Flag, 'block_on_failure', _('Block services on failure'),
			_('If checked, the addresses and names of services are blocked while the tunnel is broken. If unchecked, they go directly, past OpenZiti.'));
		o.default = '0';
		o.rmempty = false;

		override(ws, 'watchdog_probes', _('Check specific resources'),
			_('If set, the watchdog connects only to these instead of the services, and one of them must really answer. Otherwise traffic goes around the tunnel. Format: address or name, with a port if needed. Default port: 443.'),
			function (section, name) {
				var f = section.option(form.DynamicList, name, ' ');
				f.placeholder = '192.0.2.10:443';
				f.validate = function (section_id, value) {
					if (value == '' || /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(value))
						return true;
					return _('Enter an address or name, with a port if needed');
				};
				return f;
			});
		override(ws, 'verify_expect_ip', _('Check the exit address'),
			_('A check passes only if the address service sees this public IP address through the tunnel. Not checked by default.'),
			function (section, name) {
				var f = section.option(form.Value, name, ' ');
				f.datatype = 'ip4addr';
				f.placeholder = '203.0.113.10';
				return f;
			});

		var groups = [
			[ _('Checks'), [
				[ 'watchdog_interval', _('Override check interval'), _('Pause between checks, in seconds. Default: 10.'), number(1, '10') ],
				[ 'watchdog_fails', _('Override failure threshold'), _('Failed checks in a row before traffic goes around the tunnel. Default: 3.'), number(1, '3') ],
				[ 'watchdog_recover', _('Override recovery threshold'), _('Successful checks in a row before traffic returns. Default: 2.'), number(1, '2') ],
				[ 'watchdog_grace', _('Override startup delay'), _('Delay before the first check after the tunnel starts, in seconds. Default: 20.'), number(0, '20') ],
				[ 'watchdog_probe_count', _('Override addresses per check'), _('How many random service addresses one check tries. One answer from the fabric is enough, even if the service itself is down. Default: 3.'), number(1, '3') ]
			] ],
			[ _('Timeouts'), [
				[ 'watchdog_timeout', _('Override connection timeout'), _('Time to wait for a connection to one address, in seconds. The fabric reports a failed connection after about 10 seconds, so the minimum is 11. Default: 12.'), number(11, '12') ],
				[ 'watchdog_status_timeout', _('Override tunnel response timeout'), _('Time to wait for the tunnel to report its state, in seconds. No answer means it is frozen. Default: 4.'), number(1, '4') ],
				[ 'watchdog_wan_timeout', _('Override internet check timeout'), _('Time to wait for one internet check address, in seconds. Default: 4.'), number(1, '4') ],
				[ 'watchdog_dns_timeout', _('Override DNS check timeout'), _('Time to wait for a DNS answer, in seconds. Default: 5.'), number(1, '5') ],
				[ 'verify_timeout', _('Override exit check timeout'), _('Time to wait for the exit address service, in seconds. Default: 8.'), number(1, '8') ]
			] ],
			[ _('Restarts'), [
				[ 'watchdog_restart_delays', _('Override restart delays'), _('Delays before each restart while there is no connection or the tunnel is frozen, in seconds. The last one repeats. Default: 60, 300, 900, 1800.'), list('uinteger', '60') ]
			] ],
			[ _('Internet and exit'), [
				[ 'watchdog_wan_probes', _('Override internet check addresses'), _('Addresses checked outside the tunnel, to tell a lost internet connection from a fabric failure. Default: 1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222.'), list('ipaddr', '1.1.1.1') ],
				[ 'verify_url', _('Override exit address service'), _('Service that returns the public IP address, for the exit address check. Default: https://api.ipify.org.'), function (section, name) {
					var f = section.option(form.Value, name, ' ');
					f.placeholder = 'https://api.ipify.org';
					f.validate = function (section_id, value) {
						if (value == '' || /^https?:\/\/\S+$/.test(value))
							return true;
						return _('Enter a URL that starts with http:// or https://');
					};
					return f;
				} ]
			] ],
			[ _('Bypass'), [
				[ 'bypass_table', _('Override bypass routing table'), _('Routing table for traffic that goes around the tunnel. Takes effect the next time traffic goes around it. Default: 1890.'), number(256, '1890') ],
				[ 'bypass_priority', _('Override bypass rule priority'), _('Priority of the routing rule that sends traffic to that table. Takes effect the next time traffic goes around the tunnel. Default: 100.'), number(1, '100', 32765) ]
			] ]
		];

		// The list stays open while something in it is overridden, so a change is never hidden.
		var as = m.section(CollapsedSection, 'main', 'ziti');
		as.anonymous = true;
		as.summary = _('Additional watchdog settings');
		as.open = groups.some(function (g) {
			return g[1].some(function (a) { return uci.get('ziti', 'main', a[0]) != null; });
		});
		groups.forEach(function (g, i) {
			as.option(Heading, '_heading_' + i, g[0]);
			g[1].forEach(function (a) { override(as, a[0], a[1], a[2], a[3]); });
		});

		var ds = m.section(form.NamedSection, 'main', 'ziti', _('DNS'),
			_('dnsmasq asks OpenZiti first, so service names work without further setup. While the tunnel is broken, it uses the fallback servers.'));
		ds.anonymous = true;

		override(ds, 'dns_fallback_servers', _('Override fallback DNS servers'),
			_('Used when OpenZiti has no answer or the tunnel is broken. Default: 1.1.1.1, 8.8.8.8.'),
			list('ipaddr', '1.1.1.1'));
		override(ds, 'dns_upstream', _('Override upstream DNS server'),
			_('DNS server for names that are not OpenZiti services. If it is reachable only through the overlay, it needs its own service. Enter none to refuse such names. Default: 1.1.1.1.'),
			function (section, name) {
				var f = section.option(form.Value, name, ' ');
				f.placeholder = '1.1.1.1';
				f.validate = function (section_id, value) {
					if (value == '' || value == 'none' || /^(\d{1,3}\.){3}\d{1,3}$/.test(value))
						return true;
					return _('Enter an IPv4 address or none');
				};
				return f;
			});

		var results = E('div', {},
			[ E('em', {}, _('Click "Check for updates" to query the signed feed.')) ]);

		function doUpgrade(candidate) {
			if (!confirm(_('Upgrade the tunnel to %s and restart it? Clients lose connection briefly.').format(candidate)))
				return;
			ui.showModal(_('Upgrading'), [ E('p', { 'class': 'spinning' },
				_('Verifying the feed signature, installing and restarting the tunnel...')) ]);
			return callUpgrade().then(function (res) {
				ui.hideModal();
				if (res && res.error)
					return ui.addNotification(null, E('p', {}, _('Upgrade failed: ') + (res.error.message || res.error.code)), 'danger');
				ui.addNotification(null, E('p', {}, _('Upgraded to %s. Reloading...').format((res && res.version) || '')), 'info');
				window.setTimeout(function () { location.reload(); }, 3000);
			}).catch(function (e) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('Upgrade failed: ') + e.message), 'danger');
			});
		}

		function doCheck() {
			ui.showModal(_('Checking'), [ E('p', { 'class': 'spinning' },
				_('Refreshing the feed and verifying its signature...')) ]);
			return callCheck().then(function (r) {
				ui.hideModal();
				r = r || {};
				if (r.error) {
					dom.content(results, E('div', { 'class': 'alert-message warning' },
						_('Check failed: ') + (r.error.message || r.error.code)));
					return;
				}
				var upgradable = !!r.upgradable;
				var kids = [
					E('div', {}, [ _('Feed: '), E('code', {}, r.feed || _('(none configured)')) ]),
					E('div', {}, [ _('Signature: '), r.verified
						? E('span', { 'style': 'color:#5aa726;font-weight:bold' }, _('verified (signed by the project)'))
						: E('span', { 'style': 'color:#c44;font-weight:bold' }, _('NOT verified')) ]),
					E('div', {}, [ _('Installed: '), E('strong', {}, r.installed || _('?')),
						_('  Newest in feed: '), E('strong', {}, r.candidate || _('?')) ])
				];
				if (upgradable && r.verified)
					kids.push(E('div', { 'style': 'margin-top:.5em' }, [
						E('button', { 'class': 'btn cbi-button cbi-button-positive',
							'click': ui.createHandlerFn(this, function () { return doUpgrade(r.candidate); }) },
							_('Upgrade to %s').format(r.candidate)) ]));
				else if (upgradable && !r.verified)
					kids.push(E('div', { 'class': 'alert-message warning' },
						_('An update is available, but the feed signature did not verify. It cannot be installed.')));
				else
					kids.push(E('div', {}, E('em', {}, _('Up to date.'))));
				dom.content(results, kids);
			}).catch(function (e) {
				ui.hideModal();
				dom.content(results, E('div', { 'class': 'alert-message warning' }, _('Check failed: ') + e.message));
			});
		}

		return m.render().then(function (mapEl) {
			return E([], [
				E('style', {}, '#view h3 { ' + HEADING_STYLE + ' }'),
				mapEl,
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Updates')),
					E('p', { 'class': 'cbi-section-descr' },
						_('Upgrades come only from the project feed on GitHub and are refused unless its signature verifies against the imported key.')),
					E('button', { 'class': 'btn cbi-button cbi-button-action',
						'click': ui.createHandlerFn(this, doCheck) }, _('Check for updates')),
					results
				])
			]);
		});
	}
});
