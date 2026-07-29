export class DuplicateEmailError extends Error {
  constructor() {
    super('A user with this normalized email already exists');
    this.name = 'DuplicateEmailError';
  }
}
