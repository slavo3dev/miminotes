export type MimiNote = { id: string; time: number; text: string; videoId: string; createdAt: number };
export type MimiVideoData = { title: string; notes: MimiNote[] };

const key = (videoId: string) => `mimi_${videoId}`;
const posKey = (videoId: string) => `mimi_pos_${videoId}`;

export async function loadVideo(videoId: string): Promise<MimiVideoData | null> {
  const result = await chrome.storage.local.get(key(videoId));
  return result[key(videoId)] ?? null;
}

export async function saveVideo(videoId: string, data: MimiVideoData): Promise<void> {
  await chrome.storage.local.set({ [key(videoId)]: data });
}

export async function loadAll(): Promise<Record<string, MimiVideoData>> {
  const all = await chrome.storage.local.get(null);
  return Object.fromEntries(
    Object.entries(all)
      .filter(([k]) => k.startsWith('mimi_'))
      .map(([k, v]) => [k.replace('mimi_', ''), v as MimiVideoData])
  );
}

export async function deleteVideo(videoId: string): Promise<void> {
  await chrome.storage.local.remove(key(videoId));
}


export async function loadPosition(videoId: string): Promise<{ x: number; y: number }> {
  const k = posKey(videoId);
  const res = await chrome.storage.local.get(k);
  return res[k] ?? { x: 100, y: 100 };
}

export async function savePosition(videoId: string, pos: { x: number; y: number }): Promise<void> {
  const k = posKey(videoId);
  await chrome.storage.local.set({ [k]: pos });
}