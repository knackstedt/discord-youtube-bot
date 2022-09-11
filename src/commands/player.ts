import ytdl from 'ytdl-core';
import ytpl from 'ytpl';
import { createAudioResource, joinVoiceChannel, getVoiceConnection, createAudioPlayer, AudioPlayer, AudioResource, PlayerSubscription } from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextInputBuilder, ModalBuilder, GuildMember, ButtonComponentData, ComponentType, Attachment, AttachmentBuilder, MessagePayload, ButtonInteraction, TextInputStyle } from 'discord.js';
import { Client, Interaction, CommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import db from "../db";
import { MusicData, MusicPlayerData } from '../types/playerdata';
import { Subject, Subscription } from "rxjs";

function trimEllip(src, length) {
    return src.length > length ? src.substring(0, length) + "..." : src;
}

const themeName = "original";

const themePack = {
    original : {
        //━━━━━━⬤──────
        "elapsed": "━",
        "thumb": "⬤",
        "pending": "─"
    },
    shade: {
        //███████░░░░░░
        "elapsed": "█",
        "thumb": "▒",
        "pending": "░"
    },
    ascii: {
        //======+-------
        "elapsed": "=",
        "thumb": "+",
        "pending": "-"
    }
};

// This is the base theme that can be overridden.
const baseTheme = {
    "previous": "⏮️",
    "next": "⏭️",
    "pause": "⏸️",
    "play": "▶️",
    // "add": "➕",
    "add": "📝",
    "repeat": "🔁",
    "refresh": "🔄",
    "random": "🔀",
    "mute": "🔇",
    "unmute": "🔈",
    "volumedown": "🔉",
    "volumeup": "🔊",
    "clear": "🗑",
    "stop": "⛔",
    "list": "📋",
    "config": "⚙",
    "export": "📦",
    "import": "⬇️",
}

const theme = {
    ...baseTheme,
    ...themePack["ascii"],
    ...themePack[themeName]
}

const barElapsed = themePack[themeName].elapsed;
const barThumb = themePack[themeName].thumb;
const barPending = themePack[themeName].pending;



const connectionMap = {};

// Map of current audio connections
const musicStreams: {
    [key: string]: AudioResource<null>
} = {};

// Map of currently playing songs
const channelStreams: {
    [key: string]: AudioPlayer
} = {};

const guiSubjects: {
    [key: string]: Subject<any>
} = {};

const guiSubscriptions: {
    [key: string]: Subscription
} = {};


const ydlCache = {};

async function getVideoMeta(url: string) {
    if (!ydlCache[url]) {
        let data = await ytdl.getInfo(url) as any;

        // data.videoDetails.lengthSeconds

        data.url = url;
        ydlCache[url] = data;
    }
    return ydlCache[url] as MusicData;
}

function joinChannel(member: GuildMember) {
    const id = `${member.guild.id}/${member.voice.channelId}`;

    return connectionMap[id] = joinVoiceChannel({
        adapterCreator: member.guild.voiceAdapterCreator,
        channelId: member.voice.channelId,
        guildId: member.guild.id
    });
}

async function handleAudioResource(url) {
    if(/^https?:\/\/(www\.youtube\.com|youtu.be)/.test(url))
        return createAudioResource(await ytdl(url, {
            dlChunkSize: 64*1024*1024*1024,
            liveBuffer: 64*1024*1024,
            quality: 'highestaudio',
            filter: 'audioonly'
        }));
    else {
        // let spotifyTitle, spotifyArtist;
        // const spotifyTrackID = spotifyURI.parse(url).id;
        // const spotifyInfo = await spotify
        //     .request(`https://api.spotify.com/v1/tracks/${spotifyTrackID}`)
        //     .catch((err) => {
        //         return message.channel.send(`Oops... \n` + err);
        //     });
        // spotifyTitle = spotifyInfo.name;
        // spotifyArtist = spotifyInfo.artists[0].name;
    }
}

//TODO:
// add buttons if there are more then 10 in the play list to show only 10 at
// a time, a backards button and a forwards button
// better timestamp text
const pageSize = 10;
async function showMusicList(interaction: ButtonInteraction, list, page = 1) {
    let out = [];

    if (interaction.message.content) {
        page = parseInt(interaction.message.content.split("\n").pop().match(/page (?<id>\d+)/i)?.groups?.id);
    }

    let pageCount = Math.ceil(list.length / pageSize);

    if (interaction.customId.includes("[prev]"))
        page = Math.max(1, page - 1);
    if (interaction.customId.includes("[next]"))
        page = Math.min(pageCount, page + 1);


    for (let i = (page-1) * pageSize, j = 0; i < list.length && j < pageSize; i++, j++) {
        const name = list[i].user.name;
        const title = trimEllip(list[i].title, 40).padEnd(43," ");
        
        out.push(`\x1b[31m${title}\x1b[37m added by \x1b[32m${name}`);
    }

    let buttons: Partial<ButtonComponentData>[][] = pageCount > 1 ? [
        [
            {
                customId: `player::listAll[prev]`,
                emoji: theme.previous,
                style: ButtonStyle.Secondary,
                disabled: page <= 1
            },
            {
                customId: `player::listAll[next]`,
                emoji: theme.next,
                style: ButtonStyle.Secondary,
                disabled: page >= pageCount
            },
            {
                customId: `player::listAll`,
                emoji: theme.refresh,
                style: ButtonStyle.Secondary,
                disabled: false
            }
        ]
    ] : [[{
        customId: `player::listAll`,
        emoji: theme.refresh,
        style: ButtonStyle.Secondary,
        disabled: false
    }]];

    let btnResult = buttons.map(buttonRow => new ActionRowBuilder().addComponents(
        buttonRow.map((button) => new ButtonBuilder(button as any))
    ));
    
    const content = out.length > 0
        ? "```ansi\n" + out.join('\n') + `\n\x1b[0mPage ${page} of ${pageCount}.` + "```"
        : list.length == 0
            ? "No songs have been added yet"
            : "No more songs.";

    if (interaction.message.content.length > 5) {
        interaction.update({
            content: content,
            components: btnResult as any
        });
        return;
    }

    interaction.reply({
        ephemeral: true,
        content: content,
        components: btnResult as any
    });
}

async function renderGui(interaction: CommandInteraction, player: MusicPlayerData) {
    const member = interaction.member as GuildMember;
    const id = interaction.guildId + "/" + member.voice.channelId;
    
    const botUser = interaction.guild.members.me;

    if (botUser.voice.channelId && member.voice.channelId != botUser.voice.channelId)
        return { content: 'user has left the channel', ephemeral: true };

    const buttons: Partial<ButtonComponentData>[][] = [
        [
            {
                customId: 'player::previous',
                emoji: theme.previous,
                style: ButtonStyle.Secondary,
                disabled: player.index == 0 && !player.isLooping || player.musicList.length <= 0
            },
            {
                customId: player.isPaused ? "player::play" : "player::pause",
                emoji: player.isPaused ? theme.play : theme.pause,
                style: ButtonStyle.Secondary,
                disabled: !player.musicList.length
            },
            {
                customId: 'player::next',
                emoji: theme.next,
                style: ButtonStyle.Secondary,
                disabled: player.index >= player.musicList.length && !player.isLooping || player.musicList.length <= 0
            },
            {
                customId: 'player::loop',
                emoji: theme.repeat,
                style: player.isLooping ? ButtonStyle.Primary : ButtonStyle.Secondary,
                disabled: false
            },
            {
                customId: 'player::random',
                emoji: theme.random,
                style: player.isRandom ? ButtonStyle.Primary : ButtonStyle.Secondary,
                disabled: false
            },
        ],
        [
            {
                customId: 'player::dialogaddMusic',
                label: "Add Song",
                emoji: theme.add,
                style: ButtonStyle.Primary,
                disabled: false
            },
            {
                customId: 'player::listAll',
                label: "View Playlist",
                emoji: theme.list,
                style: ButtonStyle.Secondary,
                disabled: player.musicList.length == 0
            }
        ],
        [
            {
                customId: 'player::export',
                label: "Export Songs",
                emoji: theme.export,
                style: ButtonStyle.Secondary,
                disabled: player.musicList.length == 0
            },
            {
                customId: 'player::dialogImportMusicList',
                label: "Import Songs",
                emoji: theme.export,
                style: ButtonStyle.Secondary,
                disabled: player.musicList.length == 0
            },
            {
                customId: 'player::debug',
                label: "debug",
                style: ButtonStyle.Primary,
                disabled: false
            }
        ],
        [
            {
                customId: 'player::clear',
                label: "Clear Playlist",
                emoji: theme.clear,
                style: ButtonStyle.Secondary,
                disabled: player.musicList.length <= 0
            },
            {
                customId: 'player::stop',
                label: "Stop and Disconnect",
                emoji: theme.stop,
                style: ButtonStyle.Secondary,
                disabled: false
            }
        ]
    ];
    let btnResult = buttons.map(buttonRow => new ActionRowBuilder().addComponents(
            buttonRow.map((button) => new ButtonBuilder(button as any))
    ));

    if (player.musicList.length == 0) {
        const embed = new EmbedBuilder()
            .setTitle('Music Player')
            .setDescription("Music Player")
            .setColor('#ff0000')
            .addFields({ name: `Track 0 of 0`, value: "None Selected" })
            .setFooter({ text: 'Posted by ' + "" })
            .setAuthor({ name: "Music Player Bot" });

        return {
            embeds: [embed],
            ephemeral: true,
            components: btnResult
        };
    }

    // If there is any music in the queue
    if (player.index >= player.musicList.length)
        player.index = player.musicList.length - 1;

    const metadata = player.musicList[player.index];

    const vidDuration = parseInt(metadata.videoDetails.lengthSeconds);

    const min = Math.floor(vidDuration / 60);
    const sec = vidDuration % 60;
    const image = metadata.videoDetails.thumbnails[metadata.videoDetails.thumbnails.length - 1];
    // console.log(image);
    // const pfp = interaction.member.user.avatar + (interaction.member.user.avatar.startsWith("a_") ? ".gif" : ".png");

    const current = (musicStreams[id]?.playbackDuration || 0) / 1000;
    const currentMin = Math.floor(current / 60);
    const currentSec = Math.round(current % 60);

    const sliderIndex = Math.round((30 * current) / vidDuration);
    const trackText = (''.padStart(sliderIndex - 1, barElapsed) + barThumb).padEnd(30, barPending);

    const url = `https://www.youtube.com/watch?v=${metadata.videoDetails.videoId}`;
    const mdLink = `[*${trimEllip(metadata.videoDetails.title, 60)}*](${url})`;
    // const description = `
    // **Playing:**
    // ${mdLink}
    // `;

    const currentTime = currentMin.toString().padStart(2, '0') + ":" + currentSec.toString().padStart(2, '0');
    const totalTime = min.toString().padStart(2, '0') + ":" + sec.toString().padStart(2, '0');
    // Main text content
    const body = `\`${currentTime} ${trackText} ${totalTime}\``;
    
    const embed = new EmbedBuilder()
        .setTitle(trimEllip(metadata.videoDetails.title, 60))
        .setDescription(mdLink)
        .setColor('#ff0000')
        .addFields({ name: `Track ${player.index+1} of ${player.musicList.length}`, value: body })
        // .setFooter({ text: 'Queded by ' + metadata.user.name + ' at ' + new Date(metadata.dateAdded).getTime() })
        // .setAuthor({ name: "Gooey Player" })
        .setURL(url)
        .setImage(image && image.url);
    
    return { embeds: [embed], ephemeral: true, components: btnResult };
}

function getAudioStream(interaction) {
    const id = interaction.guildId + "/" + interaction.member.voice.channelId;
    
    let existingConnection = getVoiceConnection(interaction.member.voice.channel.guild.id);
    if (!existingConnection) 
        existingConnection = joinChannel(interaction.member);

    if (musicStreams[id]) {
        return {
            audioPlayer: channelStreams[id],
            voiceConnection: existingConnection,
            audioStream: musicStreams[id]
        };
    }

    // Else, we need a new audio player instance and we need to bind event listeners.
    const channelStream = channelStreams[id] = createAudioPlayer({});

    // @ts-ignore
    channelStream.on('idle', async (err, data) => {
        console.log(`Audio stream ${id} is idle. Checking for more work`);

        let player = await db.getPlayer(id);
        player.index++;
        
        if (player.index > player.musicList.length) {
            player.index = 0;

            if (!player.isLooping)
                player.musicList = [];
        }

        await db.set(id, player);
        
        if (player.musicList.length > 0) {
            console.log(`Audio stream ${id} has more music to play.`);

            playMusic({
                audioPlayer: channelStreams[id],
                voiceConnection: existingConnection,
                audioStream: musicStreams[id]
            }, player, id, interaction);

            // let metadata = player.musicList[player.index++];
            // const music = await handleAudioResource(metadata.url);

            // channelStream.play(music);
            // musicStreams[id] = music;
        }
        else 
            delete musicStreams[id];

        // Update the player
    });

    existingConnection.subscribe(channelStreams[id]);

    return {
        audioPlayer: channelStreams[id],
        voiceConnection: existingConnection,
        audioStream: musicStreams[id]
    };
}

async function playMusic(audioStream, player, id, interaction, interrupt = false) {
    if (player.musicList.length <= 0) return;

    let audioplayer: AudioPlayer = audioStream.audioPlayer;

    // Skip triggering the player if it's already playing something 
    if (
        (
            interrupt == false &&
            audioplayer?.state?.status == "playing"
        ) ||
        player.isPaused
    )
        return;
    
    if (player.index >= player.musicList.length) {
        player.index = player.musicList.length - 1;
        await db.set(id, player);
    }

    const metadata = player.musicList[player.index];
    const music = await handleAudioResource(metadata.url);

    renderGui(interaction, player);

    audioplayer.play(music);
    musicStreams[id] = music;
}


const renderIntervalCache = {};
export const command = {
    data: new SlashCommandBuilder()
        .setName('player')
        .setDescription('Show the player'),

    async execute(customId: string, interaction) {

        const id = interaction.guildId + "/" + interaction.member.voice.channelId;
        let player = await db.getPlayer(id);
        if (!player) {
            player = {
                index: 0,
                musicList: [],
                isPaused: false,
                isLooping: true,
                isRandom: false,
                currentOwner: interaction.member.id
            };
        }

        let audioStream = getAudioStream(interaction);
        const member = interaction.member as GuildMember;

        // ... 
        if (!customId) {
            playMusic(audioStream, player, id, interaction);

            if (!guiSubjects[id]) {
                guiSubjects[id] = new Subject();
                renderIntervalCache[id] = setInterval(async () => {
                    const player = await db.getPlayer(id);

                    guiSubjects[id].next(await renderGui(interaction, player));
                }, 2.1 * 1000);
            }
            
            if (guiSubscriptions[member.id])
                guiSubscriptions[member.id].unsubscribe();

            await interaction.deferReply();
            let message = await interaction.editReply(await renderGui(interaction, player));

            guiSubscriptions[member.id] = guiSubjects[id].subscribe(async gui => {
                if (interaction.replied) 
                    message.edit(gui);
            });
                                
            return;
        }

        const custom = interaction.customId.split("[")[0];
        switch(custom) {
            case "player::dialogImportMusicList": {
                interaction.showModal(new ModalBuilder()
                    .setTitle("Import a list of music to the playlist")
                    .setCustomId("player::importMusicList")
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("youtubeVideoList")
                                .setLabel("Youtube Video List")
                                .setPlaceholder("Rick Astley - Never Gonna Give You Up (Official Music Video) (https://www.youtube.com/watch?v=dQw4w9WgXcQ)")
                                .setStyle(2)
                        ) as any
                    ));
                return;
            }
            case "player::importMusicList": {
                let urls = JSON.parse(interaction.fields.fields.get("youtubeVideoUrl").value);

                const member = interaction.member as GuildMember;
                await urls.map(async song => {
                    let meta = await getVideoMeta(song.url);
                    meta.user = {
                        id: member.id,
                        name: member.displayName,
                        nick: member.nickname,
                        // avatar: member.avatarURL
                    };
                    meta.dateAdded = Date.now();
                    player.musicList.push(meta);
                });
                // save anything thats changed
                await db.set(id, player);

                // Start the player?
                playMusic(audioStream, player, id, interaction);

                await interaction.deferUpdate();
                interaction.editReply(await renderGui(interaction, player));
                return;
            }
            case "player::dialogaddMusic": {
                interaction.showModal(new ModalBuilder()
                    .setTitle("Add music to the playlist")
                    .setCustomId("player::addMusic")
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("youtubeVideoUrl")
                                .setLabel("Youtube Video or Playlist URL")
                                .setPlaceholder("https://www.youtube.com/watch?v=nQpySdJnr6I&list=RDNKooG8KM-Fc")
                                .setStyle(1)
                        ) as any
                    ));
                return;
            }
            case "player::addMusic": {
                // TODO: dedup url list
                await interaction.deferUpdate();

                let url = interaction.fields.fields.get("youtubeVideoUrl").value;

                if (!/^https:\/\/(www\.youtube\.com|youtu\.be)\//.test(url))
                    return interaction.editReply({ content: "Invalid URL" })

                let list: string;
                let playlist: ytpl.Result;
                try {
                    list = url.match(/[?&]list=(?<list>[^&]+)/).groups.list;
                    playlist = await ytpl(list);
                }
                catch(ex) {
                    // return interaction.editReply({ content: ex.message })
                }
                
                if (playlist) {
                    const member = interaction.member as GuildMember;

                    for (let i = 0; i < playlist.items.length; i++) {

                        let meta = await getVideoMeta(playlist.items[i].url);

                        meta.user = {
                            id: member.id,
                            name: member.displayName,
                            nick: member.nickname,
                            // avatar: member.avatarURL
                        };
                        meta.dateAdded = Date.now();
                        player.musicList.push(meta);

                        // On the first resolved item, start playing.
                        if (i == 0) {
                            // Add new song to list.
                            await db.set(id, player);

                            // Start the player
                            playMusic(audioStream, player, id, interaction);
                        }
                    }
                    await db.set(id, player);
                }
                else {
                    let meta = await getVideoMeta(url);
                    const duration = parseInt(meta.videoDetails.lengthSeconds);
                    if (duration > 8 * 60) {
                        interaction.editReply({ content: "Added soundtrack is too long." });
                        return;
                    }
                    const member = interaction.member as GuildMember;
    
                    meta.user = {
                        id: member.id,
                        name: member.displayName,
                        nick: member.nickname,
                        // avatar: member.avatarURL
                    };
    
                    meta.dateAdded = Date.now();
    
                    // Add new song to list.
                    player.musicList.push(meta);
                    await db.set(id, player);
    
                    // Start the player
                    playMusic(audioStream, player, id, interaction);
                }

                interaction.editReply(await renderGui(interaction, player));

                return;
            }

            case "player::reset": 
                player.index = 0;
                player.musicList = [];
                // audioStream.voiceConnection.disconnect();
                audioStream.audioPlayer?.stop();

                break;
            case "player::pause": {
                player.isPaused = true;

                if (audioStream.audioPlayer?.state?.status == "playing") 
                    audioStream.audioPlayer?.stop();

                break;
            }
            case "player::play": {
                player.isPaused = false;

                playMusic(audioStream, player, id, interaction);
                break;
            }
            case "player::previous": {
                player.index--;
                if (player.index < 0) 
                    player.index = player.musicList.length;

                playMusic(audioStream.audioStream, player, id, interaction, true);
                break;
            }
            case "player::next": {
                player.index++; 

                if (player.index >= player.musicList.length) {
                    player.index = 0;

                    if (!player.isLooping)
                        player.musicList = [];
                } 

                playMusic(audioStream.audioStream, player, id, interaction, true);
                break;
            }

            case "player::stop": {
                // TODO: destroy
                // await db.set(id, player);
                audioStream.voiceConnection.disconnect();
                interaction.update({
                    embed: [new EmbedBuilder()
                        .setTitle('Music Player')
                        .setDescription('left The channel')
                        .setColor('#000000')], 
                    ephemeral: true 
                });
                return;
            }
            case "player::clear": {
                player.musicList = [];
                channelStreams[id].stop();
                clearInterval(renderIntervalCache[id]); 
                guiSubscriptions[member.id].unsubscribe();
                guiSubjects[id].complete();

                delete guiSubscriptions[member.id];
                delete guiSubjects[id];
                break;
            }
            case "player::debug": {
                console.log("Player:", {
                    ...player,
                    musicList: player.musicList.map(m => ({
                        url: m.url,
                        user: m.user,
                        title: m.videoDetails.title,
                        author: m.videoDetails.ownerChannelName,
                        duration: m.videoDetails.lengthSeconds
                    })),
                });
                console.log("audioPlayer:", musicStreams[id]?.audioPlayer?.state?.status);
                break;
            }
            case "player::listAll": {
                const index = parseInt(interaction.customId.match(/\[(?<index>\d+)\]/)?.groups?.index);

                let meta = player.musicList.map(meta => ({
                    user: meta.user, 
                    date: meta.dateAdded, 
                    title: meta.videoDetails.title
                }));
                
                showMusicList(interaction, meta, index || 1);
                return;
            }
            case "player::shuffle": {
                player.musicList = player.musicList.sort(() => Math.random() - 0.5);
                break;
            }
            case "player::loop": {
                player.isLooping = !player.isLooping;
                break;
            } 
            case "player::random": {
                player.isRandom = !player.isRandom;
                break;
            }
            case "player::export": {
                // MessagePayload.resolveFile
                let songs = player.musicList.map(s => ({
                    title: s.videoDetails.title,
                    url: s.url
                }));

                let file = {
                    attachment: Buffer.from(JSON.stringify(songs, null, 4)),
                    name: "playlist.json"
                };
                interaction.reply({ ephemeral: true, files: [file] });
                return;
            }
        }

        await db.set(id, player);

        const menu = await renderGui(interaction, player);
        interaction.update(menu);
    }
}
