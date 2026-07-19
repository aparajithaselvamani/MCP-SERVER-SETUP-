import "./load-env.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initializeMongo } from "./mongo-store.mjs";
import { runNaturalLanguageQuery } from "./natural-language-query.mjs";
import { executeEmployeeTool, formatToolResult } from "./employee-tools.mjs";

await initializeMongo();

const server = new McpServer({
  name: "employee-mcp-server",
  version: "2.0.0"
});

server.tool(
  "natural_language_query",
  "AI Planner -> Mongo Executor -> AI Analysis for employee administration analytics.",
  {
    query: z.string().min(1).describe("Plain-English employee analytics question")
  },
  async ({ query }) => {
    const text = await runNaturalLanguageQuery(query);
    return {
      content: [{ type: "text", text }]
    };
  }
);

registerTextTool("list_employees", {}, async () => executeEmployeeTool("list_employees"));
registerTextTool(
  "get_employee_salary",
  { employee: z.string().min(1) },
  async (input) => executeEmployeeTool("get_employee_salary", input)
);
registerTextTool(
  "get_employee_department",
  { employee: z.string().min(1) },
  async (input) => executeEmployeeTool("get_employee_department", input)
);
registerTextTool(
  "employees_by_department",
  { department: z.string().min(1) },
  async (input) => executeEmployeeTool("employees_by_department", input)
);
registerTextTool("highest_salary", {}, async () => executeEmployeeTool("highest_salary"));
registerTextTool("lowest_salary", {}, async () => executeEmployeeTool("lowest_salary"));
registerTextTool("average_salary", {}, async () => executeEmployeeTool("average_salary"));
registerTextTool("employee_count", {}, async () => executeEmployeeTool("employee_count"));
registerTextTool("salary_difference", {}, async () => executeEmployeeTool("salary_difference"));
registerTextTool("average_salary_by_department", {}, async () => executeEmployeeTool("average_salary_by_department"));
registerTextTool("highest_paid_department", {}, async () => executeEmployeeTool("highest_paid_department"));
registerTextTool(
  "employee_count_by_department",
  { department: z.string().min(1) },
  async (input) => executeEmployeeTool("employee_count_by_department", input)
);
registerTextTool(
  "highest_paid_employee_in_department",
  { department: z.string().min(1) },
  async (input) => executeEmployeeTool("highest_paid_employee_in_department", input)
);
registerTextTool(
  "lowest_paid_employee_in_department",
  { department: z.string().min(1) },
  async (input) => executeEmployeeTool("lowest_paid_employee_in_department", input)
);
registerTextTool(
  "compare_employee_salary",
  { first_employee: z.string().min(1), second_employee: z.string().min(1) },
  async (input) => executeEmployeeTool("compare_employee_salary", input)
);
registerTextTool("employees_above_average_salary", {}, async () => executeEmployeeTool("employees_above_average_salary"));
registerTextTool("department_with_most_employees", {}, async () => executeEmployeeTool("department_with_most_employees"));
registerTextTool(
  "employees_by_department_sorted_by_salary",
  {
    department: z.string().min(1),
    direction: z.enum(["asc", "desc"]).optional()
  },
  async (input) => executeEmployeeTool("employees_by_department_sorted_by_salary", input)
);
registerTextTool(
  "search_employee",
  { query: z.string().min(1) },
  async (input) => executeEmployeeTool("search_employee", input)
);
registerTextTool(
  "department_payroll",
  { department: z.string().min(1) },
  async (input) => executeEmployeeTool("department_payroll", input)
);
registerTextTool("highest_payroll_department", {}, async () => executeEmployeeTool("highest_payroll_department"));
registerTextTool("lowest_payroll_department", {}, async () => executeEmployeeTool("lowest_payroll_department"));
registerTextTool(
  "top_n_highest_paid_employees",
  { n: z.number().int().positive().max(100).optional(), limit: z.number().int().positive().max(100).optional() },
  async (input) => executeEmployeeTool("top_n_highest_paid_employees", input)
);
registerTextTool(
  "bottom_n_lowest_paid_employees",
  { n: z.number().int().positive().max(100).optional(), limit: z.number().int().positive().max(100).optional() },
  async (input) => executeEmployeeTool("bottom_n_lowest_paid_employees", input)
);
registerTextTool(
  "salary_range_search",
  {
    min_salary: z.number().nonnegative(),
    max_salary: z.number().nonnegative(),
    limit: z.number().int().positive().max(100).optional()
  },
  async (input) => executeEmployeeTool("salary_range_search", input)
);
registerTextTool("median_salary", {}, async () => executeEmployeeTool("median_salary"));
registerTextTool("salary_statistics", {}, async () => executeEmployeeTool("salary_statistics"));
registerTextTool(
  "department_salary_statistics",
  { department: z.string().min(1).optional() },
  async (input) => executeEmployeeTool("department_salary_statistics", input)
);

await server.connect(new StdioServerTransport());

function registerTextTool(name, schema, handler) {
  server.tool(name, schema, async (input) => {
    const result = await handler(input ?? {});
    return {
      content: [{ type: "text", text: formatToolResult(result) }]
    };
  });
}
