import ytdl from "ytdl-core"

export type MusicPlayerData = {
    index: number,
    musicList: (ytdl.videoInfo & {url: string})[],
    isPaused: boolean,
    isLooping: boolean,
    // isPlaying: boolean,
    currentOwner: string
} 