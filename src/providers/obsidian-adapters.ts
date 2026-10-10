// The two places providers meet Obsidian: HTTP through requestUrl, and secrets through
// SecretStorage. Everything else in src/providers/ is plain TypeScript.

import { App, requestUrl } from 'obsidian';
import { Http, SecretStore } from './types';

/** Every network call PassBook makes goes through here. README "Network use" lists them. */
export const obsidianHttp: Http = async (req) => {
	const res = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	return { status: res.status, text: res.text };
};

export function obsidianSecrets(app: App): SecretStore {
	return {
		get: (id) => app.secretStorage.getSecret(id),
		set: (id, value) => app.secretStorage.setSecret(id, value),
	};
}
