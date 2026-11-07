// SPDX-License-Identifier: Apache-2.0
'use strict';
'require view';
'require rpc';
'require ui';

var callList = rpc.declare({
	object: 'ziti', method: 'list_identities', expect: { }
});
var callEnroll = rpc.declare({
	object: 'ziti', method: 'enroll', params: [ 'jwt' ], expect: { }
});
var callSetIdentity = rpc.declare({
	object: 'ziti', method: 'set_identity', params: [ 'id', 'enabled' ], expect: { }
});
var callRemove = rpc.declare({
	object: 'ziti', method: 'remove_identity', params: [ 'id' ], expect: { }
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

function readFileAsText(file) {
	return new Promise(function (resolve, reject) {
		var fr = new FileReader();
		fr.onload  = function () { resolve(String(fr.result || '')); };
		fr.onerror = function () { reject(new Error(_('Cannot read the file'))); };
		fr.readAsText(file);
	});
}

function backendError(err) {
	switch (err.code) {
	case 'set_failed': return _('Cannot change the identity. Check that the tunnel is running.');
	case 'not_found':  return _('The identity no longer exists.');
	default:           return err.message || err.code;
	}
}

function reloadOn(promise, message) {
	return promise.then(function (res) {
		if (res && res.error)
			throw new Error(backendError(res.error));
		location.reload();
	}).catch(function (e) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, message.format(e.message || e)), 'danger');
	});
}

function enrollError(err) {
	// The controller often reports an expired token as invalid, so all three read the same.
	switch (err.code) {
	case 'token-invalid':
	case 'token-expired':
	case 'token-used':    return _('The token is invalid: it has expired, was already used, or was revoked. Create a new one on the controller.');
	case 'token-format':  return _('The selected file is not an OpenZiti token.');
	case 'no-controller': return _('Cannot reach the controller named in the token. Check the internet connection.');
	case 'busy':          return _('Another operation is still running. Try again when it finishes.');
	case 'lost':          return _('The router did not return the result. Reload the page to see the current state.');
	default:              return err.message || err.code;
	}
}

function enroll(file) {
	ui.showModal(_('Enrolling...'), [
		E('p', { 'class': 'spinning' }, _('Contacting the controller and enrolling the identity...'))
	]);
	return reloadOn(readFileAsText(file).then(function (jwt) {
		return runJob(callEnroll(jwt.trim()));
	}).then(function (res) {
		if (res && res.error)
			throw new Error(enrollError(res.error));
		return res;
	}), _('Enrollment failed. %s'));
}

function remove(id, name) {
	if (!confirm(_('Delete identity %q? This cannot be undone.').format(name)))
		return;
	return reloadOn(callRemove(id), _('Failed to remove identity: %s'));
}

function statusLabel(status) {
	switch (status) {
	case 'active':   return _('Active');
	case 'disabled': return _('Disabled');
	case 'stopped':  return _('Tunnel stopped');
	default:         return _('No connection');
	}
}

return view.extend({
	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null,

	load: function () {
		return callList().catch(function () { return { identities: [] }; });
	},

	render: function (data) {
		var ids = (data && data.identities) || [];

		var rows = [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Name')),
				E('th', { 'class': 'th' }, _('Controller')),
				E('th', { 'class': 'th' }, _('Status')),
				E('th', { 'class': 'th' }, _('Enabled')),
				E('th', { 'class': 'th' }, _('Action'))
			])
		];

		if (!ids.length) {
			rows.push(E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td', 'colspan': 5 }, _('No identities enrolled.'))
			]));
		}

		ids.forEach(function (it) {
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, it.name),
				E('td', { 'class': 'td' }, it.controller || '-'),
				E('td', { 'class': 'td' }, E('span', { 'class': it.status == 'active' ? 'label success' : 'label warning' }, statusLabel(it.status))),
				E('td', { 'class': 'td' }, E('button', {
					'class': 'btn cbi-button cbi-button-' + (it.enabled ? 'positive' : 'negative'),
					'click': ui.createHandlerFn(this, function () {
						return reloadOn(callSetIdentity(it.id, !it.enabled), _('Failed: %s'));
					})
				}, it.enabled ? _('Enabled') : _('Disabled'))),
				E('td', { 'class': 'td' }, E('button', {
					'class': 'btn cbi-button cbi-button-remove',
					'click': ui.createHandlerFn(this, remove, it.id, it.name)
				}, _('Remove')))
			]));
		});

		var fileName = E('span', {}, _('No file selected'));
		var fileInput = E('input', { 'type': 'file', 'accept': '.jwt,.txt,application/jwt,text/plain', 'style': 'display:none' });
		fileInput.addEventListener('change', function () {
			var f = fileInput.files && fileInput.files[0];
			fileName.textContent = f ? f.name : _('No file selected');
		});

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OpenZiti Identities')),
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table cbi-section-table' }, rows)
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Enroll a new identity')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('JWT file')),
					E('div', { 'class': 'cbi-value-field' }, [
						fileInput,
						E('button', {
							'class': 'btn cbi-button cbi-button-action',
							'click': function (ev) { ev.preventDefault(); fileInput.click(); }
						}, _('Select file...')), ' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-positive',
							'click': ui.createHandlerFn(this, function () {
								var f = fileInput.files && fileInput.files[0];
								if (!f) {
									ui.addNotification(null, E('p', {}, _('Select a JWT file.')), 'warning');
									return;
								}
								return enroll(f);
							})
						}, _('Enroll')), ' ',
						fileName,
						E('div', { 'class': 'cbi-value-description' }, _('One-time .jwt file from your controller. The tunnel restarts when the identity is uploaded.'))
					])
				])
			])
		]);
	}
});
