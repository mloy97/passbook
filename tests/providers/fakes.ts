import { Http, HttpRequest, HttpResponse, SecretStore } from '../../src/providers/types';

export interface FakeHttp extends Http {
	requests: HttpRequest[];
}

/**
 * Answers requests in order from `responses`. A response that is an Error makes the
 * call reject, as requestUrl does when there's no response at all.
 */
export function fakeHttp(...responses: (HttpResponse | Error)[]): FakeHttp {
	const queue = [...responses];
	const requests: HttpRequest[] = [];
	const http = (async (req: HttpRequest) => {
		requests.push(req);
		const next = queue.shift();
		if (!next) throw new Error(`unexpected request: ${req.method} ${req.url}`);
		if (next instanceof Error) throw next;
		return next;
	}) as FakeHttp;
	http.requests = requests;
	return http;
}

export function json(body: unknown, status = 200): HttpResponse {
	return { status, text: typeof body === 'string' ? body : JSON.stringify(body) };
}

export function fakeSecrets(initial: Record<string, string> = {}): SecretStore & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		get: (id) => data.get(id) ?? null,
		set: (id, value) => {
			if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`invalid secret id ${id}`);
			data.set(id, value);
		},
	};
}
