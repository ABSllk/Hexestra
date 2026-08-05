import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon, type IconName } from './Icon';

const ICONS: IconName[] = [
  'activity',
  'alert',
  'bot',
  'browser',
  'check',
  'chevron-right',
  'circle',
  'close',
  'code',
  'eye',
  'file',
  'fit',
  'folder',
  'home',
  'layers',
  'map',
  'message',
  'network',
  'pause',
  'play',
  'report',
  'search',
  'send',
  'server',
  'settings',
  'shield',
  'skip',
  'sparkles',
  'target',
  'terminal',
  'tool',
  'vulnerability',
  'zoom-in',
  'zoom-out',
];

describe('Icon', () => {
  it.each(ICONS)('renders the %s icon as inline SVG', (name) => {
    const { container } = render(<Icon name={name} size={20} />);
    const svg = container.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg?.querySelector('path, circle, rect')).toBeInTheDocument();
  });
});
