import ytdl from 'ytdl-core';
import {
    createAudioResource,
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    AudioPlayer,
    AudioResource
} from '@discordjs/voice';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Collection,
    EmbedBuilder,
    TextInputBuilder,
    ModalBuilder,
    GuildMember
} from 'discord.js';
import { Client, Interaction, CommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import db from "../db";
import { MusicPlayerData } from '../types/playerdata';

function trimEllip(src, length) {
    return src.length > length ? src.substring(0, length) + "..." : src;
}

const theme = "original";

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
        "thumb": "█",
        "pending": "░"
    },
    ascii: {
        //=======-------
        "elapsed": "=",
        "thumb": "=",
        "pending": "-"
    }
}

const barElapsed = themePack[theme].elapsed;
const barThumb = themePack[theme].thumb;
const barPending = themePack[theme].pending;



const connectionMap = {};

// Map of current audio connections
const musicStreams: {
    [key: string]: AudioResource<null>
} = {};

// Map of currently playing songs
const channelStreams: {
    [key: string]: AudioPlayer
} = {};

const ydlCache = {};

async function getVideoMeta(url: string) {
    if (!ydlCache[url]) {
        let data = await ytdl.getInfo(url) as any;
        data.url = url;
        ydlCache[url] = data;
    }
    return ydlCache[url];
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
    return createAudioResource(await ytdl(url, {
        filter: 'audioonly',
        highWaterMark: 10485760,
        dlChunkSize: 0
    }));
}

//TODO:
// add buttons if there are more then 10 in the play list to show only 10 at
// a time, a backards button and a forwards button
// better timestamp text
async function showMusicList(interaction: CommandInteraction, list) {
    console.log(list);
    let out: string = "";
    for (let i in list){
        out += `\x1b[31m${trimEllip(list[i].title, 40)}\x1b[37m added by \x1b[32m${list[i].user.name}\x1b[37m at \x1b[34m${new Date(list[i].date)?.toLocaleString()}\n`;
    }
    interaction.reply({ content: `\`\`\`ansi\n${out}\`\`\``, ephemeral: true });
}

async function renderGui(interaction: CommandInteraction, player: MusicPlayerData) {
    const member = interaction.member as GuildMember;
    const id = interaction.guildId + "/" + member.voice.channelId;
    
    const botUser = interaction.guild.members.me;

    if (botUser.voice.channelId && member.voice.channelId != botUser.voice.channelId)
        return { content: 'user has left the channel', ephemeral: true };

    const btnRow1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('player::previous')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(player.index == 0 && !player.isLooping || player.musicList.length <= 0),
            new ButtonBuilder()
                .setCustomId(player.isPaused ? "player::play" : "player::pause")
                .setEmoji(player.isPaused ? '▶️' : '⏸️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!player.musicList.length),
            new ButtonBuilder()
                .setCustomId('player::next')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(player.index >= player.musicList.length && !player.isLooping || player.musicList.length <= 0)
        );
    const btnRow2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('player::showAddDialog')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false),
            new ButtonBuilder()
                .setCustomId('player::listAll')
                .setEmoji('📃')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(player.musicList.length == 0),
            new ButtonBuilder()
                .setCustomId('player::loop')
                .setEmoji('🔁')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false),
            new ButtonBuilder()
                .setCustomId('player::shuffle')
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(player.musicList.length == 0),
        );
    const btnRow3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('player::clear')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(player.musicList.length <= 0),
            new ButtonBuilder()
                .setCustomId('player::stop')
                .setEmoji('🛑')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(false),
            new ButtonBuilder()
                .setCustomId('player::debug')
                .setEmoji('🔎')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false)
        );

    if (player.musicList.length == 0) {
        const embed = new EmbedBuilder()
            .setTitle('Music Player')
            .setDescription("Music Player")
            .setColor('#ff0000')
            .addFields({ name: 'Track 0 of 0', value: "None Selected" })
            .setFooter({ text: 'Posted by ' + "" })
            .setAuthor({ name: "Music Player Bot" });

        return {
            embeds: [embed],
            ephemeral: true,
            components: [btnRow1, btnRow2, btnRow3]
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

    const mdLink = `[*${trimEllip(metadata.videoDetails.title, 60)}*](https://www.youtube.com/watch?v=${metadata.videoDetails.videoId})`;
    const description = `
    **Playing:**
    ${mdLink}
    `;

    const currentTime = currentMin.toString().padStart(2, "0") + ":" + currentSec.toString().padStart(2, "0");
    const totalTime = min.toString().padStart(2, "0") + ":" + sec.toString().padStart(2, "0");
    // Main text content
    const body = `${currentTime} \`${trackText}\` ${totalTime}`;
    
    const embed = new EmbedBuilder()
        .setTitle('Music Player')
        .setDescription(description)
        .setColor('#ff0000')
        .addFields({ name: `Track ${player.index} of ${player.musicList.length}`, value: body })
        // .addFields({ name: 'Songs in Queue', value: .toString() })
        .setFooter({ text: 'Posted by ' + metadata.videoDetails.ownerChannelName })
        .setAuthor({ name: metadata.videoDetails.ownerChannelName })
        .setImage(image && image.url);

    // Bot should join channel here

    return { embeds: [embed], ephemeral: true, components: [btnRow1, btnRow2] }
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
                currentOwner: interaction.member.id
            };
        }

        let audioStream = getAudioStream(interaction);




        // ... 
        if (!customId) {

            player.index = 0;
            player.musicList = [];
            audioStream.audioPlayer?.stop();
            await db.set(id,player);

            playMusic(audioStream, player, id, interaction);
            // await interaction.deferUpdate();
            const member = interaction.member as GuildMember;

            if (renderIntervalCache[member.id]) {
                clearInterval(renderIntervalCache[member.id])
                renderIntervalCache[member.id] = null;
            }

            renderIntervalCache[member.id] = setInterval(async () => {
                const player = await db.getPlayer(id);

                renderGui(interaction, player)
                .then(result => {
                    interaction.replied ? interaction.editReply(result) : interaction.reply(result);
                })
            }, 1000);

            interaction.reply(await renderGui(interaction, player));
            return;
        }

        switch(interaction.customId) {
            case "player::addMusicUrl": {
                // TODO: dedup url list

                let url = interaction.fields.fields.get("youtubeVideoUrl").value;

                let meta = await getVideoMeta(url);
                const member = interaction.member as GuildMember;

                meta.user = {
                    id: member.id,
                    name: member.displayName,
                    nick: member.nickname,
                    avatar: member.avatarURL
                };
                
                meta.dateAdded = Date.now();

                // Add new song to list.
                player.musicList.push(meta);
                await db.set(id, player);

                // Start the player
                playMusic(audioStream, player, id, interaction);


                await interaction.deferUpdate();
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
            case "player::showAddDialog": 
                interaction.showModal(new ModalBuilder()
                    .setTitle("Add music to the playlist")
                    .setCustomId("player::addMusicUrl")
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("youtubeVideoUrl")
                                .setLabel("Youtube Video URL")
                                .setPlaceholder("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                                .setStyle(1)
                        ) as any
                    ));
                return;
            case "player::stop": {
                // TODO: destroy
                // await db.set(id, player);
                audioStream.voiceConnection.disconnect();
                interaction.update({
                    embed: [new EmbedBuilder()
                        .setTitle('Music Player')
                        .setDescription('left The channel')
                        .setColor('#000000')], ephemeral: true 
                });
                return;
            }
            case "player::clear": {
                player.musicList = [];
                channelStreams[id].stop();
                break;
            }
            case "player::debug": {
                console.log("Player:", player);
                console.log("audioPlayer:", musicStreams[id]?.audioPlayer?.state?.status);
                break;
            }
            case "player::listAll":{
                let meta = player.musicList.map(meta => ({user:meta.user, date:meta.dateAdded, title:meta.videoDetails.title}));
                // console.log(names);
                showMusicList(interaction, meta);
                return;
            }
            case "player::shuffle":{
                player.musicList = player.musicList.sort(() => Math.random() - 0.5);
                break;
            }
            case "player::loop":{
                player.isLooping=!player.isLooping;
                break;
            }
        }
        await db.set(id, player);

        const menu = await renderGui(interaction, player);
        interaction.update(menu);
    }
}
