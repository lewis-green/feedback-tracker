import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from './Markdown.jsx';

describe('Markdown', () => {
  it('renders markdown and strips scripts', () => {
    const { container } = render(<Markdown text={'**bold** <script>alert(1)</script>'} />);
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });

  it('appends the share token to attachment image urls', () => {
    const { container } = render(
      <Markdown text={'![m](/api/attachments/5/file)'} token="tok123" />
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/api/attachments/5/file?token=tok123'
    );
  });
});
