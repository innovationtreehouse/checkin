const xlsx = require('xlsx');
const path = require('path');

const headers = [
    'First Name',
    'Last Name',
    'Email',
    'Parent Email',
    'DOB',
    'Address',
    'Same Household As'
];

const exampleRows = [
    ['John', 'Doe', 'john.doe@example.com', '', '1985-03-15', '123 Main St', ''],
    ['Jane', 'Doe', 'jane.doe@example.com', '', '1987-07-22', '123 Main St', 'John Doe'],
    ['Tommy', 'Doe', '', 'john.doe@example.com', '2015-01-10', '', ''],
    ['Sarah', 'Doe', '', 'john.doe@example.com', '2012-05-20', '', ''],
];

const ws = xlsx.utils.aoa_to_sheet([headers, ...exampleRows]);

ws['!cols'] = [
    { wch: 15 },  // First Name
    { wch: 15 },  // Last Name
    { wch: 30 },  // Email
    { wch: 30 },  // Parent Email
    { wch: 12 },  // DOB
    { wch: 25 },  // Address
    { wch: 25 },  // Same Household As
];

const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, 'Participants');

const outPath = path.join(__dirname, '..', 'public', 'Participant_Import_Template.xlsx');
xlsx.writeFile(wb, outPath);
console.log('✓ Template generated at: ' + outPath);
