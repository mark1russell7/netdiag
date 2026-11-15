#!/usr/bin/env node
// The program `netdiag`. The function `main` has the command line. This file only starts it.
import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2));
