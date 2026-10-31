export class TrimmerError extends Error {
    constructor(message, exitCode = 1, options) {
        super(message, options);
        this.exitCode = exitCode;
    }
}
