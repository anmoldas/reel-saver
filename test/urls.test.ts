import { describe, expect, it } from 'vitest';
import { canonicalize, extractUrl, resolvePostUrl } from '../src/urls.js';

describe('canonicalize', () => {
  it.each([
    ['https://www.instagram.com/reel/ABC_12-x/?igsh=xyz', 'https://www.instagram.com/reel/ABC_12-x/'],
    ['https://instagram.com/reels/ABC123', 'https://www.instagram.com/reel/ABC123/'],
    ['https://www.instagram.com/someuser/reel/ABC123/', 'https://www.instagram.com/reel/ABC123/'],
    ['https://www.instagram.com/p/XYZ/', 'https://www.instagram.com/p/XYZ/'],
    ['https://www.tiktok.com/@chef.joe/video/7300000000000000000?is_from_webapp=1', 'https://www.tiktok.com/@chef.joe/video/7300000000000000000'],
    ['https://m.tiktok.com/@a/photo/123', 'https://www.tiktok.com/@a/photo/123'],
  ])('%s', (input, expected) => {
    expect(canonicalize(new URL(input))).toBe(expected);
  });

  it('does not treat share links as posts', () => {
    expect(canonicalize(new URL('https://www.instagram.com/share/reel/BAabc/'))).toBeNull();
    expect(canonicalize(new URL('https://vm.tiktok.com/ZMabc/'))).toBeNull();
  });
});

describe('extractUrl', () => {
  it('finds the link inside shared text', () => {
    expect(extractUrl('Check this out! https://vm.tiktok.com/ZMabc/ so good')).toBe('https://vm.tiktok.com/ZMabc/');
    expect(extractUrl('no link')).toBeNull();
  });
});

const redirect = (to: string) => new Response(null, { status: 301, headers: { location: to } });

describe('resolvePostUrl', () => {
  it('follows TikTok short links', async () => {
    const fetchMock = (async () => redirect('https://www.tiktok.com/@a/video/42?_r=1')) as typeof fetch;
    await expect(resolvePostUrl('https://vm.tiktok.com/ZMabc/', fetchMock)).resolves.toEqual({
      url: 'https://www.tiktok.com/@a/video/42',
      platform: 'tiktok',
    });
  });

  it('reads the real post out of an Instagram login redirect', async () => {
    const fetchMock = (async () =>
      redirect('https://www.instagram.com/accounts/login/?next=%2Freel%2FREAL1%2F%3Figsh%3Dx')) as typeof fetch;
    await expect(resolvePostUrl('https://www.instagram.com/share/reel/BAabc/', fetchMock)).resolves.toEqual({
      url: 'https://www.instagram.com/reel/REAL1/',
      platform: 'instagram',
    });
  });

  it('rejects other sites without fetching', async () => {
    await expect(resolvePostUrl('https://youtube.com/shorts/x', (() => {
      throw new Error('should not fetch');
    }) as typeof fetch)).rejects.toThrow(/Only Instagram and TikTok/);
  });
});
