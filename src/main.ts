import { Client, Collection, GatewayIntentBits, SlashCommandBuilder, Routes, Interaction, CommandInteraction, ApplicationCommand } from 'discord.js';
import { REST } from '@discordjs/rest';
import db from "./db";
import fs from 'fs';
// import { SlashCommandBuilder } from '@discordjs/builders';
import { Command } from './types/command';
import path from "path";

require('dotenv').config();


export class MusicPlayerServer {

    private client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    commands = new Collection();

    rest: REST;
    commandList = this.commands.map(e => e[0]);

    public __init: Promise<void>;
    constructor(private token: string, private botId: string, private serverId: string) {
        this.__init = this.initialize();
    }

    async initialize() {
        await this.registerCommands();

        this.initializeClient();
    }

    registerCommands() {
        const commands = [];
        const commandsPath = path.join(__dirname, 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => /\.[jt]s$/.test(file));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const {command} = require(filePath);
            commands.push(command.data.toJSON());
            this.commands.set(command.data.name, command);
        }

        this.rest = new REST({ version: "10" }).setToken(this.token);

        return this.rest.put(Routes.applicationGuildCommands(this.botId, this.serverId), { body: commands });
    }

    initializeClient() {
        const client = this.client;
        
        client.on('ready', this.onReady.bind(this));
        client.on('interactionCreate', this.onInteractionCreate.bind(this));

        client.login(this.token).catch(e => console.error(e));
    }

    onReady() {
        console.log(`\x1b[32m${this.client.user.tag} is running\x1b[0m`);
    }

    async onInteractionCreate(interaction: CommandInteraction) {

        const guild = interaction.guild.name;
        const channel = interaction.channel.name;
        const user = interaction.user.username;

        const customId: string = interaction['customId'];

        // const originalCommand = customId.split("_")[0]
        
        let commandGroup = interaction.commandName || customId.split('::')[0];
        console.log(`Begin processing command [${customId || commandGroup}]`);

        try {

            const command = this.commands.get(commandGroup) as Command;
            if (!command) {
                console.log("Command", command, "not found.")
                return await interaction.reply({ content: 'Command not found.', ephemeral: true });
            }

            return await command.execute(customId, interaction)
                .catch(err => console.error(err));
        }
        catch (ex) {
            const message = "[" + commandGroup + "] " + (typeof ex == "string" ? ex : ex.message || 'There was an error while executing this command!');
            await interaction.reply({ content: message, ephemeral: true });
        }
    };

    async destroy() {
        this.client.destroy();
    }
}

// Sample constructor
const mps = new MusicPlayerServer(process.env['token'], "1003141876523737128", "1013969943529803776");