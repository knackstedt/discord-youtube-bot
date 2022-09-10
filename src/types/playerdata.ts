import ytdl from "ytdl-core"

export type MusicPlayerData = {
    index: number,
    musicList: (
        ytdl.videoInfo & {
            url: string,
            user: {
                id: string,
                name: string,
                nick: string
            },
            dateAdded: number
        })[],
    isPaused: boolean,
    isLooping: boolean,
    currentOwner: string
} 