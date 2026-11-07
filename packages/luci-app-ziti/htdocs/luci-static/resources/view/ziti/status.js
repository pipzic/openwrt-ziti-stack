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
	case 'unchecked':     return _('Not checked: the watchdog is off');
	case 'no-identities': return _('No identities enrolled');
	case 'no-services':   return _('No services available, traffic goes around the tunnel');
	case 'no-internet':   return _('No internet connection');
	case 'no-connection': return _('No connection to the controller or OpenZiti routers, traffic goes around the tunnel');
	case 'no-data':       return _('Connected, but services do not respond, traffic goes around the tunnel');
	case 'hung':          return _('The tunnel is not responding, restarting');
	default:              return state || _('unknown');
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
			])
		]);
	}
});
