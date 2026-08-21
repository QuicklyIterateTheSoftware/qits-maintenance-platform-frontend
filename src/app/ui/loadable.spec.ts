import { HttpErrorResponse } from '@angular/common/http';
import { describeError, statusOf } from './loadable';

/**
 * What a failed read says.
 *
 * The status stays in front of the service's own sentence, because "503" and "404" send an operator
 * to different places, and a request that never got an answer says so in words rather than quoting
 * an HTTP code that does not exist.
 */
describe('describeError', () => {
  it('prefers the service’s message and keeps the status in front of it', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: 'An application name is required' },
    });
    expect(describeError(error)).toBe('400 An application name is required');
  });

  it('says unreachable when the request never got an answer', () => {
    expect(describeError(new HttpErrorResponse({ status: 0 }))).toBe('the service is unreachable');
    expect(statusOf(new HttpErrorResponse({ status: 0 }))).toBe(0);
  });

  it('falls back to the status alone when the body carries no message', () => {
    expect(describeError(new HttpErrorResponse({ status: 503, error: 'gateway said no' }))).toBe(
      '503',
    );
  });

  it('reads an empty message as no message at all', () => {
    const error = new HttpErrorResponse({ status: 400, error: { message: '' } });
    expect(describeError(error)).toBe('400');
  });
});
