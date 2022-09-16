import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextInputBuilder, ModalBuilder, GuildMember, ButtonComponentData, ComponentType, Attachment, AttachmentBuilder, MessagePayload, ButtonInteraction, TextInputStyle } from 'discord.js';
import { Client, Interaction, CommandInteraction } from 'discord.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import db from "../db";

export const command = {
    data: new SlashCommandBuilder()
        .setName('createlogger')
        .setDescription('set up the logging channel')
        .addChannelOption(option => 
            option
                .setName('channel')
                .setDescription('Select a channel')
                .setRequired(true)
        ),
    async execute(customId: string, interaction) {
        console.log(interaction,customId)
    }
}