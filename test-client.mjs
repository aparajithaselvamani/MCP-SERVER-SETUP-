import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["server.mjs"],
  env: process.env
});

const client = new Client({
  name: "employee-test-client",
  version: "1.0.0"
});

const smokeQuestion = process.argv[2];
const runIntentTests = smokeQuestion === "--tests";
const intentTestQueries = [
  "Who has the highest salary?",
  "Who has the highest salary and what department do they work in?",
  "Compare the salaries of Aarav and Maya.",
  "Which department has the highest average salary and how many employees work there?",
  "Which department has the highest average salary and who is the highest paid employee there?",
  "Which department has the most employees and what is its average salary?",
  "Who earns more between Aarav and Maya?",
  "Who earns the highest salary in Engineering?",
  "Show employees earning above the average salary.",
  "Which department has the most employees?",
  "List Engineering employees sorted by salary.",
  "Which department spends the most on salaries?",
  "Show top 5 highest paid employees.",
  "Show bottom 5 employees by salary.",
  "Show employees earning between 80000 and 120000.",
  "What is the median salary?",
  "Show salary statistics.",
  "What is the minimum salary?",
  "Who earns the least?",
  "What is the difference between highest and lowest salary?",
  "What is the average salary?",
  "How many employees are there?",
  "List employees in Administration",
  "Show employees with salary greater than 120000"
];

try {
  await client.connect(transport);

  if (runIntentTests) {
    for (const query of intentTestQueries) {
      console.log(`\nQ: ${query}`);
      const result = await client.callTool({
        name: "natural_language_query",
        arguments: { query }
      });
      printToolResponse(result);
    }
  } else if (smokeQuestion) {
    const result = await client.callTool({
      name: "natural_language_query",
      arguments: { query: smokeQuestion }
    });
    printToolResponse(result);
  } else {
    const rl = readline.createInterface({ input, output });
    console.log("Employee AI Assistant");
    console.log("Connected to MCP Server.");
    console.log("");
    console.log("Type 'exit' to quit.");
    console.log("");

    while (true) {
      const question = (await rl.question("> ")).trim();
      const command = question.toLowerCase();

      if (command === "exit" || command === "quit") {
        break;
      }

      if (question.length === 0) {
        continue;
      }

      const result = await client.callTool({
        name: "natural_language_query",
        arguments: {
          query: question
        }
      });

      printToolResponse(result);
    }

    rl.close();
  }
} finally {
  await client.close();
}

function printToolResponse(result) {
  for (const item of result.content) {
    if (item.type === "text") {
      console.log(item.text);
    }
  }
}
