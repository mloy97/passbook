/** An expected failure whose message is written for users and shown as-is. */
export class UserFacingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UserFacingError';
	}
}
