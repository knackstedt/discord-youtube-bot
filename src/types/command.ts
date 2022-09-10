import { SlashCommandBuilder } from '@discordjs/builders';

export type Command = {
    name: string,
    description: string,
    run?: (interaction, args) => Promise<any>,
    button?: (interaction) => Promise<any>,
    modal?: (interaction) => Promise<any>,
    select?: (interaction) => Promise<any>,


    data: SlashCommandBuilder,
    execute: (...args) => any
}