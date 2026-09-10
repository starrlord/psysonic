/**
 * "Add to CD" on an album menu.
 *
 * The gating tests in `ContextMenu.test.tsx` only prove the item renders. These
 * click it and read the burn list back, because the failure modes that matter —
 * queueing the first track, queueing the album backwards, losing a track's own
 * server — all render an identical menu.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubsonicAlbum, SubsonicSong } from '@/lib/api/subsonicTypes';
import { offlineActionPolicy } from '@/features/offline';
import { songToBurnTrack, useBurnListStore } from '@/features/burner';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';
import type { ContextMenuItemsProps } from './contextMenuItemTypes';
import AlbumContextItems from './AlbumContextItems';

const burnAvailable = vi.hoisted(() => ({ current: true }));
vi.mock('@/features/contextMenu/hooks/useBurnMenuAvailable', () => ({
  useBurnMenuAvailable: () => burnAvailable.current,
}));

const resolveAlbum = vi.hoisted(() => vi.fn());
vi.mock('@/features/offline', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/offline')>()),
  resolveAlbum: (...args: unknown[]) => resolveAlbum(...args),
  resolveMediaServerId: (serverId?: string | null) => serverId ?? 'srv',
}));

const song = (id: string, overrides: Partial<SubsonicSong> = {}): SubsonicSong => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  albumId: 'al-1',
  duration: 180,
  ...overrides,
} as SubsonicSong);

const album = (overrides: Partial<SubsonicAlbum> = {}): SubsonicAlbum => ({
  id: 'al-1',
  name: 'Album',
  artist: 'Artist',
  artistId: 'ar-1',
  serverId: 'srv',
  songCount: 3,
  duration: 540,
  ...overrides,
} as SubsonicAlbum);

/** What the resolver hands back for an album. */
const resolved = (songs: SubsonicSong[]) => ({ album: album(), songs });

function renderMenu(item: SubsonicAlbum, overrides: Partial<ContextMenuItemsProps> = {}) {
  const spies = {
    playNext: vi.fn(),
    enqueue: vi.fn(),
    copyShareLink: vi.fn(),
    downloadAlbum: vi.fn(),
    applyAlbumRating: vi.fn(),
    navigateLibrary: vi.fn(),
  };
  const props = {
    type: 'album',
    item,
    userRatingOverrides: {},
    setStarredOverride: vi.fn(),
    setKeyboardRating: vi.fn(),
    keyboardRating: null,
    closeContextMenu: vi.fn(),
    playlistSubmenuOpen: false,
    setPlaylistSubmenuOpen: vi.fn(),
    cancelPlaylistSubmenuCloseTimer: vi.fn(),
    onPlaylistSubmenuTriggerMouseLeave: vi.fn(),
    playlistSongIds: [],
    setPlaylistSongIds: vi.fn(),
    entityRatingSupport: 'full',
    handleAction: (action: () => void | Promise<void>) => action(),
    isStarred: (_id: string, itemStarred?: string) => Boolean(itemStarred),
    pinToPlaybackServer: false,
    offlinePolicy: offlineActionPolicy('contextMenuAlbum', false),
    ...spies,
    ...overrides,
  } as unknown as ContextMenuItemsProps;
  renderWithProviders(<AlbumContextItems {...props} />);
  return spies;
}

const queuedTrackIds = () => useBurnListStore.getState().tracks.map(track => track.trackId);

describe('AlbumContextItems — Add to CD', () => {
  beforeEach(() => {
    useBurnListStore.getState().clear();
    resolveAlbum.mockReset();
    burnAvailable.current = true;
  });

  it('queues every track on the album, in album order', async () => {
    const user = userEvent.setup();
    resolveAlbum.mockResolvedValue(resolved([song('a'), song('b'), song('c')]));
    renderMenu(album());

    await user.click(screen.getByText('Add to CD'));

    // Order is the whole point: the resolver returns disc-then-track order and
    // the store appends, so the disc plays the way the album does.
    expect(queuedTrackIds()).toEqual(['a', 'b', 'c']);
  });

  it("keeps each track's own server id rather than the album's", async () => {
    const user = userEvent.setup();
    resolveAlbum.mockResolvedValue(resolved([
      song('a', { serverId: 'other' }),
      song('b', { serverId: 'other' }),
    ]));
    renderMenu(album({ serverId: 'srv' }));

    await user.click(screen.getByText('Add to CD'));

    // The key carries the owner; streaming and downloads resolve against it.
    expect(useBurnListStore.getState().tracks.map(track => track.key))
      .toEqual(['other:a', 'other:b']);
  });

  it('queues nothing when the album cannot be resolved', async () => {
    const user = userEvent.setup();
    resolveAlbum.mockResolvedValue(null);
    renderMenu(album());

    // Deliberately silent — same as "Play Next" and "Enqueue Album" — but it
    // must not reject either, since handleAction runs it with no catch.
    await expect(user.click(screen.getByText('Add to CD'))).resolves.toBeUndefined();

    expect(useBurnListStore.getState().tracks).toHaveLength(0);
  });

  it('stops at the 99-track ceiling', async () => {
    const user = userEvent.setup();
    useBurnListStore.getState().add(
      Array.from({ length: 97 }, (_, i) => songToBurnTrack(song(`seed-${i}`), 'srv')),
    );
    resolveAlbum.mockResolvedValue(resolved(
      ['a', 'b', 'c', 'd', 'e'].map(id => song(id)),
    ));
    renderMenu(album());

    await user.click(screen.getByText('Add to CD'));

    expect(useBurnListStore.getState().tracks).toHaveLength(99);
    expect(queuedTrackIds().slice(97)).toEqual(['a', 'b']);
  });

  it('hides the item when the burn gate says no', () => {
    burnAvailable.current = false;
    renderMenu(album());

    expect(screen.queryByText('Add to CD')).toBeNull();
    // The rest of the menu is untouched by the gate.
    expect(screen.getByText('Enqueue Album')).toBeInTheDocument();
  });
});
