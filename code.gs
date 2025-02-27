// ไฟล์ Code.gs ใน Google Apps Script
// นี่เป็นตัวอย่างของ Google Apps Script ที่ใช้เชื่อมต่อเว็บแอปพลิเคชันกับ Google Sheets

// ID ของ Google Sheets ที่เป็นฐานข้อมูล (ต้องเปลี่ยนเป็น ID จริงของคุณ)
var SPREADSHEET_ID = '1Zag0TDYxRsMAtTAMfIpqFlDLJPpza2aSGa8Ze4BwbtM';

// ชื่อของแต่ละช่วงแผ่นงานใน Google Sheets
var STUDENTS_SHEET_NAME = 'รายชื่อนักศึกษา';
var QUESTIONS_SHEET_NAME = 'คำถาม';
var RESPONSES_SHEET_NAME = 'ผลการประเมิน';

function doGet(e) {
  var action = '';
  var studentId = '';
  var result = {};
  
  // ตรวจสอบว่า e และ e.parameter มีค่าหรือไม่
  if (e && e.parameter) {
    action = e.parameter.action || '';
    studentId = e.parameter.studentId || '';
  }
  
  // บันทึกล็อกเพื่อตรวจสอบค่าที่ได้รับ
  Logger.log("พารามิเตอร์ที่ได้รับ - action: " + action + ", studentId: " + studentId);
  
  try {
    if (action === 'getStudentCourses') {
      if (!studentId) {
        result = { error: true, message: 'ไม่ได้ระบุรหัสนักศึกษา' };
      } else {
        result = getStudentCourses(studentId);
      }
    } else if (action === 'getQuestions') {
      result = getQuestions();
    } else if (action === 'updateStatus') {
      // เพิ่มการรองรับคำสั่งอัปเดตสถานะโดยตรงผ่าน GET
      if (!e.parameter.studentId || !e.parameter.courseName || !e.parameter.teacherName || !e.parameter.semester) {
        result = { error: true, message: 'ข้อมูลไม่ครบถ้วนสำหรับการอัปเดตสถานะ' };
      } else {
        // เรียกใช้ฟังก์ชันอัปเดตสถานะ
        var updated = updateEvaluationStatus(
          e.parameter.studentId,
          e.parameter.courseName,
          e.parameter.teacherName,
          e.parameter.semester
        );
        result = { error: false, updated: updated, message: 'อัปเดตสถานะเรียบร้อยแล้ว' };
      }
    } else {
      result = { error: false, message: 'ระบบพร้อมใช้งาน' };
    }
  } catch (error) {
    Logger.log("เกิดข้อผิดพลาด: " + error.toString());
    result = { error: true, message: error.toString() };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON)

}


// ฟังก์ชันนี้จะทำงานเมื่อมีการส่งข้อมูล POST
function doPost(e) {
  try {
    // ใช้ LockService เพื่อป้องกันการเขียนพร้อมกันหลายคน
    var lock = LockService.getScriptLock();
    lock.tryLock(10000); // ล็อคสคริปต์ 10 วินาที
    
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("ไม่พบข้อมูลที่ส่งมา");
    }
    
    var params = JSON.parse(e.postData.contents);
    
    // บันทึกล็อกเพื่อตรวจสอบข้อมูลที่ได้รับ
    Logger.log("POST data: " + JSON.stringify(params));
    
    // เปิด Spreadsheet
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var responseSheet = spreadsheet.getSheetByName(RESPONSES_SHEET_NAME);
    
    // ตรวจสอบว่าพบชีทสำหรับบันทึกข้อมูลหรือไม่
    if (!responseSheet) {
      // ถ้าไม่พบชีท ให้สร้างใหม่
      responseSheet = spreadsheet.insertSheet(RESPONSES_SHEET_NAME);
      
      // สร้างหัวตารางด้วยจำนวนคอลัมน์ที่เพียงพอสำหรับทุกคำถาม
      var headers = ["Timestamp", "รหัสนักศึกษา", "ชื่อวิชา", "ชื่ออาจารย์", "ภาคการศึกษา"];
      
      // ดึงคำถามจากชีท QUESTIONS_SHEET_NAME
      var questionsSheet = spreadsheet.getSheetByName(QUESTIONS_SHEET_NAME);
      if (questionsSheet) {
        var questionData = questionsSheet.getDataRange().getValues();
        
        // เพิ่มคำถามแต่ละข้อเป็นหัวตาราง
        for (var i = 1; i < questionData.length; i++) {
          if (questionData[i][0]) {
            // ตัดคำถามให้สั้นลงถ้ายาวเกินไป
            var questionHeader = "คำถามที่ " + i + ": " + questionData[i][0];
            if (questionHeader.length > 50) {
              questionHeader = questionHeader.substring(0, 47) + "...";
            }
            headers.push(questionHeader);
          }
        }
      } else {
        // ถ้าไม่มีชีทคำถาม ให้ใช้ชื่อ default
        for (var i = 1; i <= 20; i++) { // สมมติว่ามีคำถามไม่เกิน 20 ข้อ
          headers.push("คำถามที่ " + i);
        }
      }
      
      // บันทึกหัวตาราง
      responseSheet.appendRow(headers);
      
      // จัดรูปแบบหัวตาราง (ให้อ่านง่าย)
      responseSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      responseSheet.setFrozenRows(1);
    }
    
    // ตรวจสอบข้อมูลที่จำเป็น
    if (!params.studentId || !params.courseName || !params.teacherName || !params.semester || !params.answers) {
      throw new Error("ข้อมูลไม่ครบถ้วน");
    }
    
    // สร้างข้อมูลที่จะบันทึก
    var timestamp = new Date();
    var studentId = params.studentId;
    var courseName = params.courseName;
    var teacherName = params.teacherName;
    var semester = params.semester;
    var answers = params.answers;
    
    // สร้างอาร์เรย์สำหรับบันทึกข้อมูล เริ่มด้วยข้อมูลพื้นฐาน
    var rowData = [timestamp, studentId, courseName, teacherName, semester];
    
    // เพิ่มคำตอบแต่ละข้อลงในอาร์เรย์
    if (Array.isArray(answers)) {
      // กรณีที่ answers เป็น array อยู่แล้ว
      for (var i = 0; i < answers.length; i++) {
        rowData.push(answers[i]);
      }
    } else if (typeof answers === 'object') {
      // กรณีที่ answers เป็น object
      for (var key in answers) {
        rowData.push(answers[key]);
      }
    } else {
      // กรณีอื่นๆ บันทึกทั้ง answers เป็น string ในเซลล์เดียว
      rowData.push(JSON.stringify(answers));
    }
    
    // บันทึกข้อมูลลงในชีท
    responseSheet.appendRow(rowData);
    
    // อัปเดตสถานะการประเมิน
    var updateResult = updateEvaluationStatus(studentId, courseName, teacherName, semester);
    Logger.log("ผลการอัปเดตสถานะ: " + updateResult);
    
    // ปลดล็อค
    lock.releaseLock();
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success', 
      message: 'บันทึกข้อมูลเรียบร้อยแล้ว',
      statusUpdated: updateResult
    }))
    .setMimeType(ContentService.MimeType.JSON)
    
  } catch(error) {
    // ปลดล็อคในกรณีเกิดข้อผิดพลาด
    if (lock && lock.hasLock()) {
      lock.releaseLock();
    }
    
    Logger.log("เกิดข้อผิดพลาดใน POST: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
}

// ฟังก์ชันดึงข้อมูลรายวิชาของนักศึกษา
function getStudentCourses(studentId) {
  if (!studentId) {
    return { error: true, message: 'ไม่ได้ระบุรหัสนักศึกษา' };
  }
  
  try {
    // เปิด Google Sheets
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = spreadsheet.getSheetByName(STUDENTS_SHEET_NAME);
    
    if (!sheet) {
      return { error: true, message: 'ไม่พบชีทข้อมูลนักศึกษา' };
    }
    
    // ดึงข้อมูลทั้งหมด
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    
    if (values.length === 0) {
      return { error: true, message: 'ไม่พบข้อมูลในชีท' };
    }
    
    // บันทึกล็อกข้อมูลหัวตาราง
    Logger.log("หัวตาราง: " + JSON.stringify(values[0]));
    
    // ข้ามแถวแรก (หัวตาราง)
    var headers = values[0];
    var studentIdColIndex = headers.indexOf('รหัสนักศึกษา');
    var semesterColIndex = headers.indexOf('ภาคการศึกษา');
    var courseNameColIndex = headers.indexOf('ชื่อวิชา');
    var teacherNameColIndex = headers.indexOf('ชื่ออาจารย์');
    var statusColIndex = headers.indexOf('สถานะการทำแบบทดสอบ');
    
    // บันทึกล็อกตำแหน่งคอลัมม์
    Logger.log("ตำแหน่งคอลัมม์: studentId=" + studentIdColIndex + 
              ", semester=" + semesterColIndex + 
              ", courseName=" + courseNameColIndex + 
              ", teacherName=" + teacherNameColIndex + 
              ", status=" + statusColIndex);
    
    if (studentIdColIndex === -1 || semesterColIndex === -1 || courseNameColIndex === -1 || 
        teacherNameColIndex === -1 || statusColIndex === -1) {
      return { error: true, message: 'รูปแบบชีทข้อมูลไม่ถูกต้อง' };
    }
    
    // ค้นหารายวิชาของนักศึกษา
    var courses = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      if (row[studentIdColIndex] == studentId) { // ใช้ == แทน === เพื่อความยืดหยุ่นในการเปรียบเทียบ
        courses.push({
          courseName: row[courseNameColIndex],
          teacherName: row[teacherNameColIndex],
          semester: row[semesterColIndex],
          status: row[statusColIndex]
        });
      }
    }
    
    Logger.log("พบรายวิชาทั้งหมด: " + courses.length + " วิชา");
    
    return { error: false, courses: courses };
  } catch (error) {
    Logger.log("เกิดข้อผิดพลาดในการดึงข้อมูลรายวิชา: " + error.toString());
    return { error: true, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลรายวิชา: ' + error.toString() };
  }
}

// ฟังก์ชันดึงข้อมูลคำถาม
function getQuestions() {
  try {
    // เปิด Google Sheets
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = spreadsheet.getSheetByName(QUESTIONS_SHEET_NAME);
    
    if (!sheet) {
      return { error: true, message: 'ไม่พบชีทข้อมูลคำถาม' };
    }
    
    // ดึงข้อมูลทั้งหมด
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    
    if (values.length === 0) {
      return { error: true, message: 'ไม่พบข้อมูลคำถามในชีท' };
    }
    
    // สร้างรายการคำถาม (ข้ามแถวแรกที่อาจเป็นหัวตาราง)
    var questions = [];
    for (var i = 1; i < values.length; i++) {
      if (values[i][0]) {
        questions.push(values[i][0]);
      }
    }
    
    Logger.log("พบคำถามทั้งหมด: " + questions.length + " ข้อ");
    
    return { error: false, questions: questions };
  } catch (error) {
    Logger.log("เกิดข้อผิดพลาดในการดึงข้อมูลคำถาม: " + error.toString());
    return { error: true, message: 'เกิดข้อผิดพลาดในการดึงข้อมูลคำถาม: ' + error.toString() };
  }
}


// ฟังก์ชันอัปเดตสถานะการประเมิน (ปรับปรุงใหม่ทั้งหมด)
function updateEvaluationStatus(studentId, courseName, teacherName, semester) {
  try {
    // บันทึกล็อกข้อมูลที่ได้รับ
    Logger.log("กำลังอัปเดตสถานะ: รหัสนักศึกษา=" + studentId + 
              ", วิชา=" + courseName + 
              ", อาจารย์=" + teacherName + 
              ", ภาคเรียน=" + semester);
    
    // เปิด Google Sheets โดยตรงด้วย ID
    var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) {
      Logger.log("ไม่สามารถเปิดสเปรดชีตได้ ตรวจสอบ SPREADSHEET_ID");
      return false;
    }
    
    // เปิดชีท "รายชื่อนักศึกษา"
    var sheet = spreadsheet.getSheetByName(STUDENTS_SHEET_NAME);
    if (!sheet) {
      Logger.log("ไม่พบชีท 'รายชื่อนักศึกษา'");
      return false;
    }
    
    // ดึงข้อมูลทั้งหมดในชีท
    var dataRange = sheet.getDataRange();
    var values = dataRange.getValues();
    
    // บันทึกจำนวนแถวและคอลัมน์
    var numRows = values.length;
    var numCols = numRows > 0 ? values[0].length : 0;
    
    Logger.log("จำนวนแถวทั้งหมด: " + numRows + ", จำนวนคอลัมน์: " + numCols);
    
    if (numRows <= 1) {
      Logger.log("ไม่พบข้อมูลในชีท หรือมีเพียงหัวตาราง");
      return false;
    }
    
    // ตรวจสอบหัวตาราง
    var headers = values[0];
    Logger.log("หัวตาราง: " + headers.join(", "));
    
    // ค้นหาตำแหน่งคอลัมน์
    var studentIdColIndex = -1;
    var courseNameColIndex = -1;
    var teacherNameColIndex = -1;
    var semesterColIndex = -1;
    var statusColIndex = -1;
    
    // ค้นหาตำแหน่งคอลัมน์แบบไม่คำนึงถึงตัวอักษรและเครื่องหมาย
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i]).toLowerCase().trim();
      
      if (header.indexOf("รหัสนักศึกษา") >= 0) {
        studentIdColIndex = i;
      } else if (header.indexOf("ชื่อวิชา") >= 0) {
        courseNameColIndex = i;
      } else if (header.indexOf("อาจารย์") >= 0) {
        teacherNameColIndex = i;
      } else if (header.indexOf("ภาคเรียน") >= 0 || header.indexOf("ภาคการศึกษา") >= 0) {
        semesterColIndex = i;
      } else if (header.indexOf("สถานะ") >= 0 && (header.indexOf("ทดสอบ") >= 0 || header.indexOf("ประเมิน") >= 0)) {
        statusColIndex = i;
      }
    }
    
    // บันทึกล็อกตำแหน่งคอลัมน์
    Logger.log("ตำแหน่งคอลัมน์ที่พบ: รหัสนักศึกษา=" + studentIdColIndex + 
              ", วิชา=" + courseNameColIndex + 
              ", อาจารย์=" + teacherNameColIndex + 
              ", ภาคเรียน=" + semesterColIndex + 
              ", สถานะ=" + statusColIndex);
    
    // ตรวจสอบว่าพบคอลัมน์ที่จำเป็นหรือไม่
    if (studentIdColIndex === -1 || courseNameColIndex === -1 || 
        teacherNameColIndex === -1 || semesterColIndex === -1 || statusColIndex === -1) {
      Logger.log("ไม่พบคอลัมน์ที่จำเป็นในชีท");
      return false;
    }
    
    // แปลงพารามิเตอร์ให้เป็นสตริง
    studentId = String(studentId).trim();
    courseName = String(courseName).trim();
    teacherName = String(teacherName).trim();
    semester = String(semester).trim();
    
    var rowIndexToUpdate = -1;
    var matchFound = false;
    
    // ค้นหาแถวที่ตรงกับเงื่อนไข
    for (var i = 1; i < numRows; i++) {
      var row = values[i];
      
      // ตรวจสอบว่ามีข้อมูลครบถ้วนหรือไม่
      if (row.length <= Math.max(studentIdColIndex, courseNameColIndex, teacherNameColIndex, semesterColIndex, statusColIndex)) {
        Logger.log("แถว " + (i+1) + " มีคอลัมน์ไม่ครบ ข้าม");
        continue;
      }
      
      // แปลงข้อมูลในแถวให้เป็นสตริง
      var rowStudentId = String(row[studentIdColIndex] || "").trim();
      var rowCourseName = String(row[courseNameColIndex] || "").trim();
      var rowTeacherName = String(row[teacherNameColIndex] || "").trim();
      var rowSemester = String(row[semesterColIndex] || "").trim();
      
      // บันทึกข้อมูลสำหรับดีบั๊ก
      Logger.log("แถว " + (i+1) + ": รหัสนักศึกษา=" + rowStudentId + 
                ", วิชา=" + rowCourseName + 
                ", อาจารย์=" + rowTeacherName + 
                ", ภาคเรียน=" + rowSemester);
      
      // เปรียบเทียบค่าแบบไม่คำนึงถึงตัวอักษร
      if (rowStudentId.toLowerCase() === studentId.toLowerCase() && 
          rowCourseName.toLowerCase() === courseName.toLowerCase() && 
          rowTeacherName.toLowerCase() === teacherName.toLowerCase() && 
          rowSemester.toLowerCase() === semester.toLowerCase()) {
        
        rowIndexToUpdate = i + 1;  // บวก 1 เพราะ Sheet เริ่มที่แถว 1 แต่ Array เริ่มที่ 0
        matchFound = true;
        
        Logger.log("พบแถวที่ตรงกัน: แถว " + rowIndexToUpdate);
        break;
      }
    }
    
    if (!matchFound) {
      Logger.log("ไม่พบแถวที่ตรงกับเงื่อนไข");
      return false;
    }
    
    // อัปเดตค่าในเซลล์
    try {
      // ใช้ direct A1 notation เพื่อความแม่นยำ
      var columnLetter = columnToLetter(statusColIndex + 1);  // แปลงเลขคอลัมน์เป็นตัวอักษร (A, B, C, ...)
      var cellAddress = columnLetter + rowIndexToUpdate;
      
      Logger.log("กำลังอัปเดตเซลล์ " + cellAddress + " เป็นค่า 'ประเมินแล้ว'");
      
      // อัปเดตค่าในเซลล์
      var cell = sheet.getRange(cellAddress);
      cell.setValue("ประเมินแล้ว");
      
      // ตรวจสอบว่าอัปเดตสำเร็จหรือไม่
      var updatedValue = cell.getValue();
      Logger.log("ค่าหลังอัปเดต: " + updatedValue);
      
      if (updatedValue === "ประเมินแล้ว") {
        Logger.log("อัปเดตสถานะสำเร็จ");
        return true;
      } else {
        Logger.log("อัปเดตค่าไม่สำเร็จ");
        return false;
      }
    } catch (innerError) {
      Logger.log("เกิดข้อผิดพลาดขณะพยายามอัปเดตเซลล์: " + innerError.toString());
      
      // พยายามอีกวิธี
      try {
        Logger.log("ลองใช้เมธอด getRange(row, column) แทน");
        var statusCell = sheet.getRange(rowIndexToUpdate, statusColIndex + 1);
        statusCell.setValue("ประเมินแล้ว");
        
        Logger.log("อัปเดตค่าด้วยวิธีสำรองสำเร็จ");
        return true;
      } catch (fallbackError) {
        Logger.log("เกิดข้อผิดพลาดแม้ใช้วิธีสำรอง: " + fallbackError.toString());
        return false;
      }
    }
  } catch (error) {
    Logger.log("เกิดข้อผิดพลาดในฟังก์ชัน updateEvaluationStatus: " + error.toString());
    return false;
  }
}

// ฟังก์ชันแปลงเลขคอลัมน์เป็นตัวอักษร (เช่น 1 -> A, 2 -> B, ...)
function columnToLetter(column) {
  var temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

// ฟังก์ชันสำหรับทดสอบ API
function testAPI() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  
  ui.alert(
    'URL ของ Web App',
    'URL สำหรับเชื่อมต่อกับเว็บไซต์: ' + url + '\n\n' +
    'ตรวจสอบให้แน่ใจว่าได้ตั้งค่าการเผยแพร่เป็น "Anyone" หรือ "Anyone, even anonymous" แล้ว',
    ui.ButtonSet.OK
  );
}

// ฟังก์ชันทดสอบการอัปเดตสถานะ
function testUpdateStatus() {
  var studentId = "123456"; // ใส่รหัสนักศึกษาตัวอย่าง
  var courseName = "วิชาตัวอย่าง"; // ใส่ชื่อวิชาตัวอย่าง
  var teacherName = "อาจารย์ตัวอย่าง"; // ใส่ชื่ออาจารย์ตัวอย่าง
  var semester = "1/2566"; // ใส่ภาคการศึกษาตัวอย่าง
  
  var result = updateEvaluationStatus(studentId, courseName, teacherName, semester);
  Logger.log("ผลการทดสอบอัปเดตสถานะ: " + result);
  return result;
}

// ฟังก์ชันทดสอบ
function test() {
  var testResult = getQuestions();
  Logger.log(JSON.stringify(testResult));
  return testResult;
}

// ฟังก์ชันนี้จะทำงานเมื่อเปิด Google Sheet
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('แบบประเมิน')
      .addItem('ทดสอบ API', 'testAPI')
      .addItem('ทดสอบอัปเดตสถานะ', 'testUpdateStatus')
      .addToUi();
}
