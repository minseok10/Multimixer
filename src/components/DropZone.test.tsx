import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DropZone } from './DropZone';

const props = {
  onFiles: () => undefined,
  onLoadDemo: () => undefined,
  loading: false,
  compact: true,
};

describe('DropZone', () => {
  it('hides the demo action for an R2 song', () => {
    const html = renderToStaticMarkup(<DropZone {...props} showDemo={false} />);
    expect(html).not.toContain('데모 스템 로드');
    expect(html).toContain('파일 선택');
  });

  it('keeps the demo action for custom uploads', () => {
    const html = renderToStaticMarkup(<DropZone {...props} showDemo />);
    expect(html).toContain('데모 스템 로드');
  });
});
