// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require dom';
'require tools.widgets as widgets';

var callCheck = rpc.declare({
	object: 'ziti', method: 'check_update', expect: { }
});
var callUpgrade = rpc.declare({
	object: 'ziti', method: 'upgrade_zet', expect: { }
});
var callJob = rpc.declare({
	object: 'ziti', method: 'job_status', expect: { }
});

// Long operations run in the background on the router. This waits for their answer.
function runJob(start) {
	return start.then(function (res) {
		if (!res || res.error || !res.job)
			return res;
		return (function poll() {
			return new Promise(function (resolve) { window.setTimeout(resolve, 2000); }).then(function () {
				return callJob();
			}).then(function (st) {
				if (st && st.running)
					return poll();
				return (st && st.job == res.job && st.result) || { error: { code: 'lost', message: '' } };
			});
		})();
	});
}

function updateError(err) {
	switch (err.code) {
	case 'update_failed': return _('Cannot refresh the package lists. Check the internet connection and the feed signing key.');
	case 'no_update':     return _('No installable update from the project feed.');
	case 'busy':          return _('Another operation is still running. Try again when it finishes.');
	case 'lost':          return _('The router did not return the result. Reload the page to see the current state.');
	default:              return err.message || err.code;
	}
}

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
			_('Changes apply without restarting the tunnel.'));

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
			_('Log detail level. Info is recommended for normal use. Default: Info.'));
		o.value('ERROR', 'Error'); o.value('WARN', 'Warning'); o.value('INFO', 'Info');
		o.value('DEBUG', 'Debug'); o.value('VERBOSE', 'Verbose'); o.value('TRACE', 'Trace');
		o.default = 'INFO';

		o = s.option(widgets.ZoneSelect, 'source_zones', _('Source zones'),
			_('Firewall zones whose traffic may enter the tunnel. Default: lan.'));
		o.multiple = true;
		o.nocreate = true;
		o.default = 'lan';

		var ws = m.section(form.NamedSection, 'main', 'ziti', _('Watchdog'),
			_('Automatically checks the tunnel, enables bypass on failure, and restores tunnel routing after recovery. The tunnel keeps trying to reconnect.'));
		ws.anonymous = true;

		o = ws.option(form.Flag, 'watchdog_enabled', _('Enable watchdog'),
			_('If disabled, the watchdog does not check the tunnel or enable bypass on failure.'));
		o.default = '1';
		o.rmempty = false;

		o = ws.option(form.Flag, 'block_on_failure', _('Block services on failure'),
			_('During bypass, block traffic to cached service addresses and names. With the watchdog on, installed rules also prevent source-zone traffic to cached non-default service prefixes from falling back to less specific routes after an unexpected process exit. If disabled, bypass uses the router\'s normal routes.'));
		o.default = '0';
		o.rmempty = false;

		override(ws, 'watchdog_probes', _('Check specific resources'),
			_('Use these resources instead of automatic service probes. At least one resource selected for each check must accept a TCP connection; otherwise the check fails. Format: address or hostname, optionally followed by a port. Default port: 443.'),
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

		var groups = [
			[ _('Checks'), [
				[ 'watchdog_interval', _('Override check interval'), _('Pause between checks, in seconds. Default: 5.'), number(1, '5') ],
				[ 'watchdog_fails', _('Override failure threshold'), _('Consecutive failed checks before enabling bypass. An unresponsive tunnel triggers bypass immediately. Default: 3.'), number(1, '3') ],
				[ 'watchdog_recover', _('Override recovery threshold'), _('Consecutive successful checks before restoring tunnel routing. Default: 2.'), number(1, '2') ],
				[ 'watchdog_grace', _('Override startup delay'), _('Delay before the first check after the tunnel starts, in seconds. Default: 15.'), number(0, '15') ],
				[ 'watchdog_probe_count', _('Override addresses per check'), _('Maximum number of randomly selected addresses per check. For automatic service probes, an OpenZiti network response is enough, even if the service is down. Default: 3.'), number(1, '3') ]
			] ],
			[ _('Timeouts'), [
				[ 'watchdog_timeout', _('Override connection timeout'), _('Connection timeout per address, in seconds. The OpenZiti network reports a failed connection after about 10 seconds, so the minimum is 11. Default: 12.'), number(11, '12') ],
				[ 'watchdog_status_timeout', _('Override tunnel response timeout'), _('Timeout for each tunnel status request, in seconds. A failed request or timeout marks the tunnel as unresponsive. Default: 4.'), number(1, '4') ],
				[ 'watchdog_wan_timeout', _('Override internet check timeout'), _('Time to wait for one internet check address, in seconds. Default: 3.'), number(1, '3') ],
				[ 'watchdog_dns_timeout', _('Override DNS check timeout'), _('Time to wait for a DNS answer, in seconds. Default: 3.'), number(1, '3') ]
			] ],
			[ _('Restarts'), [
				[ 'watchdog_restart_delays', _('Override restart delays'), _('Delays before restart attempts when the tunnel is unresponsive or disconnected despite internet access, in seconds. The last delay repeats. Default: 30, 120, 600, 1800.'), list('uinteger', '30') ]
			] ],
			[ _('Internet check'), [
				[ 'watchdog_wan_probes', _('Override internet check addresses'), _('Addresses checked outside the tunnel to distinguish an internet outage from an OpenZiti network failure. Default: 1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222.'), list('ip4addr', '1.1.1.1') ]
			] ],
			[ _('Bypass'), [
				[ 'bypass_table', _('Override bypass routing table'), _('Routing table used for bypass. Changes take effect the next time bypass is enabled. Default: 1890.'), number(256, '1890') ],
				[ 'bypass_priority', _('Override bypass rule priority'), _('Priority of the routing rule that selects the bypass table. Changes take effect the next time bypass is enabled. Default: 100.'), number(1, '100', 32765) ]
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

		var results = E('div', {},
			[ E('em', {}, _('Click "Check for updates" to query the signed feed.')) ]);

		function doUpgrade(candidate) {
			if (!confirm(_('Upgrade the tunnel to %s and restart it?').format(candidate)))
				return;
			ui.showModal(_('Upgrading'), [ E('p', { 'class': 'spinning' },
				_('Verifying the feed signature, installing and restarting the tunnel...')) ]);
			return runJob(callUpgrade()).then(function (res) {
				ui.hideModal();
				if (res && res.error)
					return ui.addNotification(null, E('p', {}, _('Upgrade failed:') + ' ' + updateError(res.error)), 'danger');
				ui.addNotification(null, E('p', {}, _('Upgraded to %s. Reloading...').format((res && res.version) || '')), 'info');
				window.setTimeout(function () { location.reload(); }, 3000);
			}).catch(function (e) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, _('Upgrade failed:') + ' ' + e.message), 'danger');
			});
		}

		function doCheck() {
			ui.showModal(_('Checking'), [ E('p', { 'class': 'spinning' },
				_('Refreshing the feed and verifying its signature...')) ]);
			return runJob(callCheck()).then(function (r) {
				ui.hideModal();
				r = r || {};
				if (r.error) {
					dom.content(results, E('div', { 'class': 'alert-message warning' },
						_('Check failed:') + ' ' + updateError(r.error)));
					return;
				}
				var upgradable = !!r.upgradable;
				var kids = [
					E('div', {}, [ _('Feed:') + ' ', E('code', {}, r.feed || _('(none configured)')) ]),
					E('div', {}, [ _('Signature:') + ' ', r.verified
						? E('span', { 'style': 'color:#5aa726;font-weight:bold' }, _('verified by apk'))
						: E('span', { 'style': 'color:#c44;font-weight:bold' }, _('NOT verified')) ]),
					E('div', {}, [ _('Installed:') + ' ', E('strong', {}, r.installed || _('?')),
						' ' + _('Newest in feed:') + ' ', E('strong', {}, r.candidate || _('?')) ])
				];
				if (r.other)
					kids.push(E('div', { 'class': 'alert-message warning' },
						_('Version %s in another repository is newer. Only updates from the project feed are offered.').format(r.other)));
				if (upgradable && r.verified)
					kids.push(E('div', { 'style': 'margin-top:.5em' }, [
						E('button', { 'class': 'btn cbi-button cbi-button-positive',
							'click': ui.createHandlerFn(this, function () { return doUpgrade(r.candidate); }) },
							_('Upgrade to %s').format(r.candidate)) ]));
				else if (upgradable && !r.verified)
					kids.push(E('div', { 'class': 'alert-message warning' },
						_('An update is available, but the feed signature did not verify. It cannot be installed.')));
				else if (!r.other)
					kids.push(E('div', {}, E('em', {}, _('Up to date.'))));
				dom.content(results, kids);
			}).catch(function (e) {
				ui.hideModal();
				dom.content(results, E('div', { 'class': 'alert-message warning' }, _('Check failed:') + ' ' + e.message));
			});
		}

		return m.render().then(function (mapEl) {
			return E([], [
				E('style', {}, '#view h3 { ' + HEADING_STYLE + ' }'),
				mapEl,
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, _('Updates')),
					E('p', { 'class': 'cbi-section-descr' },
						_('Updates are offered only from the project feed on GitHub. apk verifies repository signatures against the installed keys before installation.')),
					E('button', { 'class': 'btn cbi-button cbi-button-action',
						'click': ui.createHandlerFn(this, doCheck) }, _('Check for updates')),
					results
				])
			]);
		});
	}
});
