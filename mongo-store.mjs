import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://admin:password@localhost:27017";
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? "employee_admin";
const EMPLOYEE_COLLECTION = process.env.MONGO_COLLECTION ?? "employees";
const ATTENDANCE_COLLECTION = process.env.MONGO_ATTENDANCE_COLLECTION ?? "employee_attendance";
const PAYROLL_COLLECTION = process.env.MONGO_PAYROLL_COLLECTION ?? "employee_payroll";
const REVIEW_COLLECTION = process.env.MONGO_REVIEW_COLLECTION ?? "employee_reviews";

let client;
let database;
let employeesCollection;
let attendanceCollection;
let payrollCollection;
let reviewCollection;

export async function initializeMongo() {
  if (employeesCollection) {
    return;
  }

  client = new MongoClient(MONGO_URI);
  await client.connect();
  database = client.db(MONGO_DB_NAME);
  employeesCollection = database.collection(EMPLOYEE_COLLECTION);
  attendanceCollection = database.collection(ATTENDANCE_COLLECTION);
  payrollCollection = database.collection(PAYROLL_COLLECTION);
  reviewCollection = database.collection(REVIEW_COLLECTION);

  await dropLegacyIndexes(employeesCollection);

  await employeesCollection.createIndex({ name: 1 });
  await employeesCollection.createIndex({ department: 1 });
  await employeesCollection.createIndex({ city: 1 });
  await employeesCollection.createIndex({ salary: 1 });
  await employeesCollection.createIndex({ age: 1 });
  await employeesCollection.createIndex({ remote: 1 });
  await employeesCollection.createIndex({ joiningDate: 1 });
  await attendanceCollection.createIndex({ employeeId: 1 });
  await attendanceCollection.createIndex({ date: 1 });
  await payrollCollection.createIndex({ employeeId: 1 });
  await payrollCollection.createIndex({ month: 1 });
  await reviewCollection.createIndex({ employeeId: 1 });
  await reviewCollection.createIndex({ reviewDate: 1 });

  await seedLargeDummyAdministrationData();
}

export function employees() {
  if (!employeesCollection) {
    throw new Error("MongoDB not initialized");
  }
  return employeesCollection;
}

export function payroll() {
  if (!payrollCollection) {
    throw new Error("MongoDB not initialized");
  }
  return payrollCollection;
}

export function attendance() {
  if (!attendanceCollection) {
    throw new Error("MongoDB not initialized");
  }
  return attendanceCollection;
}

export function reviews() {
  if (!reviewCollection) {
    throw new Error("MongoDB not initialized");
  }
  return reviewCollection;
}

async function seedLargeDummyAdministrationData() {
  const count = await employeesCollection.countDocuments();
  const attendanceCount = await attendanceCollection.countDocuments();
  const payrollCount = await payrollCollection.countDocuments();
  const reviewCount = await reviewCollection.countDocuments();

  if (count >= 1000) {
    const sample = await employeesCollection.findOne({}, { projection: { _id: 0, city: 1, joiningDate: 1 } });
    if (
      sample &&
      "city" in sample &&
      "joiningDate" in sample &&
      attendanceCount >= count * 5 &&
      payrollCount >= count * 2 &&
      reviewCount >= count * 0.8
    ) {
      return;
    }
  }

  const departments = [
    "Administration",
    "Engineering",
    "Finance",
    "Product",
    "Operations",
    "Human Resources",
    "Sales",
    "Legal"
  ];
  const cities = ["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai"];

  const docs = [];
  for (let i = 1; i <= 1500; i += 1) {
    const department = departments[i % departments.length];
    const city = cities[i % cities.length];
    const age = 22 + (i % 36);
    const remote = i % 3 === 0;
    const salary = 35000 + ((i * 1379) % 175000);

    docs.push({
      name: `Employee ${i}`,
      age,
      department,
      salary,
      city,
      joiningDate: new Date(2014 + (i % 12), i % 12, (i % 27) + 1),
      remote
    });
  }

  if (count < 1000) {
    await employeesCollection.deleteMany({});
    await employeesCollection.insertMany(docs, { ordered: true });
  } else {
    const sample = await employeesCollection.findOne({}, { projection: { _id: 0, city: 1, joiningDate: 1 } });
    if (!sample || !("city" in sample) || !("joiningDate" in sample)) {
      await employeesCollection.deleteMany({});
      await employeesCollection.insertMany(docs, { ordered: true });
    }
  }

  await ensureNamedSampleEmployees();
  await seedRelatedCollectionsFromExistingEmployees();
}

async function ensureNamedSampleEmployees() {
  const namedSamples = [
    {
      name: "Aarav Mehta",
      age: 34,
      department: "Engineering",
      salary: 95000,
      city: "Bengaluru",
      joiningDate: new Date(2020, 4, 12),
      remote: false
    },
    {
      name: "Maya Sharma",
      age: 31,
      department: "Product",
      salary: 88000,
      city: "Mumbai",
      joiningDate: new Date(2021, 7, 9),
      remote: true
    }
  ];

  for (const employee of namedSamples) {
    await employeesCollection.updateOne(
      { name: employee.name },
      { $setOnInsert: employee },
      { upsert: true }
    );
  }
}

async function dropLegacyIndexes(collection) {
  try {
    await collection.dropIndex("employeeId_1");
  } catch {
    // Index might not exist; safe to ignore.
  }
}

async function seedRelatedCollectionsFromExistingEmployees() {
  const attendanceDocs = [];
  const payrollDocs = [];
  const reviewDocs = [];

  const employeeDocs = await employeesCollection
    .find({}, { projection: { _id: 1, name: 1, department: 1, salary: 1 } })
    .sort({ name: 1 })
    .toArray();

  for (let i = 0; i < employeeDocs.length; i += 1) {
    const employeeId = employeeDocs[i]._id;
    const employee = employeeDocs[i];

    for (let m = 1; m <= 3; m += 1) {
      payrollDocs.push({
        employeeId,
        month: `2026-${String(m).padStart(2, "0")}`,
        baseSalary: employee.salary,
        bonus: (employee.salary % 7000) + m * 500,
        deductions: (employee.salary % 2500) + m * 120,
        netSalary: employee.salary + ((employee.salary % 7000) + m * 500) - ((employee.salary % 2500) + m * 120),
        currency: "INR",
        paidAt: new Date(2026, m, 1)
      });
    }

    for (let d = 1; d <= 7; d += 1) {
      attendanceDocs.push({
        employeeId,
        date: new Date(2026, 0, d),
        status: d % 6 === 0 ? "leave" : d % 7 === 0 ? "remote" : "present",
        checkInHour: d % 6 === 0 ? null : 9 + (i % 2),
        checkOutHour: d % 6 === 0 ? null : 18 + (i % 2)
      });
    }

    reviewDocs.push({
      employeeId,
      reviewDate: new Date(2025, (i % 12), (i % 27) + 1),
      rating: 2 + (i % 4),
      goalsCompleted: 60 + (i % 41),
      reviewer: `Manager ${((i % 55) + 1)}`,
      summary: `Annual review for ${employee.name} in ${employee.department}.`
    });
  }

  await attendanceCollection.deleteMany({});
  await payrollCollection.deleteMany({});
  await reviewCollection.deleteMany({});
  await attendanceCollection.insertMany(attendanceDocs, { ordered: false });
  await payrollCollection.insertMany(payrollDocs, { ordered: false });
  await reviewCollection.insertMany(reviewDocs, { ordered: false });
}
