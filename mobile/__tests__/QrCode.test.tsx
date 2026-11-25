import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {QrCode} from '../src/QrCode';
import {darkRuns, qrMatrix} from '../src/qr';

function leaves(node: ReactTestRenderer.ReactTestInstance, color: string): number {
  return node.findAll(n => typeof n.type === 'string' && n.props.style && flat(n.props.style).backgroundColor === color).length;
}
function flat(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {});
}

test('QR рисуется по сериям: полос столько же, сколько тёмных серий, фон белый', async () => {
  const rows = qrMatrix('vpn test');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<QrCode rows={rows} />);
  });
  const root = tree.root.findByProps({testID: 'key-qr'});
  const runs = rows.reduce((sum, row) => sum + darkRuns(row).length, 0);
  expect(leaves(root, '#000000')).toBe(runs);
  expect(flat(root.props.style).backgroundColor).toBe('#ffffff');
  const side = flat(root.props.style).width as number;
  expect(side).toBeLessThanOrEqual(260);
  expect(side % (rows.length + 8)).toBe(0); // целое число пикселей на модуль
});
