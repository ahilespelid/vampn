/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders the centered vampn button', async () => {
  (globalThis as {fetch: typeof fetch}).fetch = jest
    .fn()
    .mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => {
      setImmediate(() => resolve());
    });
  });

  const tree = JSON.stringify(renderer!.toJSON());
  expect(tree).toContain('vampn');
  expect(tree).toContain('сбросить IP');
  expect(tree).toContain('нет интернет');
});
