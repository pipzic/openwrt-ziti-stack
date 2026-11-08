// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'ziti', method: 'status', expect: { }
});
var callServiceAction = rpc.declare({
	object: 'ziti', method: 'service_action', params: [ 'action' ], expect: { }
});
var callSetAutostart = rpc.declare({
	object: 'ziti', method: 'set_autostart', params: [ 'enabled' ], expect: { }
});

function finish(promise) {
	return promise.then(function (res) {
		if (res && res.error)
			throw new Error(res.error.message || res.error.code);
		window.setTimeout(function () { location.reload(); }, 750);
	}).catch(function (e) {
		ui.addNotification(null, E('p', {}, _('Failed: %s').format(e.message || e)), 'danger');
	});
}

function actionButton(label, action, style) {
	return E('button', {
		'class': 'btn cbi-button cbi-button-' + style,
		'click': ui.createHandlerFn(this, function () { return finish(callServiceAction(action)); })
	}, label);
}

function row(title, content, hint) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, title),
		E('div', { 'class': 'cbi-value-field' }, [].concat(
			content,
			hint ? E('div', { 'class': 'cbi-value-description' }, hint) : []
		))
	]);
}

function stateLabel(state) {
	switch (state) {
	case 'healthy':       return _('Working');
	case 'starting':      return _('Starting');
	case 'stopped':       return _('Stopped');
	case 'crashed':       return _('Tunnel process exited; waiting for procd to restart it');
	case 'unchecked':     return _('Not checked: the watchdog is off');
	case 'no-identities': return _('No identities enrolled');
	case 'no-services':   return _('No services available; tunnel bypass enabled');
	case 'no-internet':   return _('No internet connection');
	case 'no-connection': return _('No connection to the controller or OpenZiti routers; tunnel bypass enabled');
	case 'no-data':       return _('Connected, but traffic checks failed; tunnel bypass enabled');
	case 'no-routes':     return _('Tunnel routes missing; tunnel bypass enabled, restart pending');
	case 'hung':          return _('Tunnel not responding; restart pending');
	default:              return state || _('unknown');
	}
}

// The watchdog reports warnings as "code argument...".
function warningText(w) {
	var a = w.split(' ');
	switch (a[0]) {
	case 'invalid_settings': return _('The watchdog could not enable tunnel exceptions: the bypass rule priority, bypass table or reply mark was invalid.');
	case 'table_taken':      return _('The watchdog could not enable tunnel exceptions: routing table %s or %s was not empty.').format(a[1], a[2]);
	case 'priority_taken':   return _('The watchdog could not enable tunnel exceptions: routing rule priority %s was already in use.').format(a[1]);
	case 'several_wan':      return _('The watchdog found default routes on more than one device. Replies to connections from WAN may leave through a different WAN.');
	case 'bypass_taken':     return _('The watchdog could not enable bypass: routing table %s or rule priority %s was already in use.').format(a[1], a[2]);
	case 'nft_rejected':     return _('The generated firewall rules for replies to WAN connections were rejected by nft.');
	default:                 return w;
	}
}

return view.extend({
	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null,

	load: function () {
		return callStatus();
	},

	render: function (data) {
		data = data || {};
		var guard = data.guard || {}, fabric = Array.isArray(guard.fabric) ? guard.fabric : [];

		function hosts(cls) {
			return fabric.filter(function (h) { return h.class == cls; }).map(function (h) {
				var text = h.name + ' (' + h.ip + (h.target && h.target != '-' && h.target != h.ip ? ' → ' + h.target : '') + ')';
				return E('div', {}, text);
			});
		}

		var extra = [];
		var lan = hosts('lan'), outside = hosts('public'), unresolved = hosts('unresolved');
		if (lan.length)
			extra.push(row(_('Ziti hosts in the LAN'), lan,
				_('Controllers and routers found in the source zones. With Ziti hosts in the LAN bypass the tunnel enabled, their traffic from those zones bypasses the tunnel completely.')));
		if (outside.length)
			extra.push(row(_('Ziti hosts outside the source zones'), outside,
				_('The router reaches these controllers and routers around the tunnel.')));
		if (unresolved.length)
			extra.push(row(_('Ziti hosts with unknown location'), unresolved,
				_('The watchdog could not determine their location. If a host is in a source zone, add its address under Bypass the tunnel completely.')));
		(Array.isArray(guard.warnings) ? guard.warnings : []).forEach(function (w) {
			extra.push(E('div', { 'class': 'alert-message warning' }, warningText(String(w))));
		});
		if (guard.pending)
			extra.push(E('div', { 'class': 'alert-message notice' },
				_('Changes to the bypass table, bypass rule priority or reply mark take effect after a reboot.')));

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OpenZiti Status')),
			E('div', { 'class': 'cbi-section' }, [
				row(_('Service'), E('span', { 'class': data.running ? 'label success' : 'label warning' },
					data.running ? _('running') : _('stopped'))),
				row(_('State'), stateLabel(data.state)),
				row(_('Version'), data.version || _('unknown')),
				row(_('Start at boot'), E('button', {
					'class': 'btn cbi-button cbi-button-' + (data.autostart ? 'positive' : 'negative'),
					'click': ui.createHandlerFn(this, function () { return finish(callSetAutostart(!data.autostart)); })
				}, data.autostart ? _('Enabled') : _('Disabled'))),
				row(_('Control'), [
					actionButton(_('Start'), 'start', 'action'), ' ',
					actionButton(_('Stop'), 'stop', 'negative'), ' ',
					actionButton(_('Restart'), 'restart', 'action')
				])
			].concat(extra))
		]);
	}
});
