import ytdl from "ytdl-core"

export type MusicData = ytdl.videoInfo & {
    url: string,
    user: {
        id: string,
        name: string,
        nick: string,
        avatar?: string
    },
    dateAdded: number
};

export type MusicPlayerData = {
    index: number,
    musicList: MusicData[],
    isPaused: boolean,
    isLooping: boolean,
    isRandom: boolean,
    currentOwner: string
} 