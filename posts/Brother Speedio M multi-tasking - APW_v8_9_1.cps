/**
  Copyright (C) 2012-2026 by Autodesk, Inc.
  All rights reserved.

  Brother Speedio multi tasking post processor configuration.

  $Revision: 44229 e780fd31175d3ecc1f0eb61106a1f48cbb5c06bf $
  $Date: 2026-06-12 11:32:13 $

  FORKID {665F2538-1853-4747-ABC5-8ACA1027A805}
*/

/*
APW CHANGE LOG  --  merged onto stock Autodesk rev 44229 (2026-06-12)
Previous shop post: "Brother multi-tasking - APW v5.4cl.cps" (stock base rev 44188)

Ported features (search for "APW" to find every change):
  APW 4.1   Blum tool break detection            COMMAND_BREAK_CONTROL + prepareForToolCheck()
  APW 4.2   Blum work-offset probe shift         6 properties, #190/#191/#192, 21 call sites
  APW 4.4   Program header                       POSTED stamp, FILE NAME, custom tool list
  APW 4.5   Comment settings                     extra chars + / ? *,  line length 110
  APW 4.6   Property defaults                    Blum, M298, 1500 rpm, smoothing Automatic
  APW 4.7   Misc                                 T#=H# check, job description, unit warning off
  APW 4.8   Moved job/tool description comment    now sits immediately before the G100 tool call
  APW 4.9   Toolpath type comment                 raw operation-strategy id, grouped with 4.7b
  APW 4.10  Holder description noise removed       no holder -> omit segment, no extra comment line

API renames applied for rev 44229:
  disableLengthCompensation(f, comment) -> cancelLengthCompensation(f)   [2nd arg removed]
  toolLengthCompOutput                  -> lengthCompOutput
  .setCurrent(49)                       -> .setCurrent(lengthCompCodes.cancel)

NOT PORTED - needs a decision, see REVIEW notes:
  Z home / M298-with-TPC work in progress from v5.4
  chip washdown writeComment lines (they were commented out, i.e. dead)

  V7.1  7/30/26 DWY Looked through can compared each changed and checked posted code - Should be good but still check normal things
  V7.2 8/7/26 DWY Add fixture property
  V7.2.1 8/14/26 DWY added M211 at end for D control - not tested on C control

  V8.0  8/25/26 DWY Tool setting / probing work. All edits tagged "APW 8.0x".
    APW 8.0a  Optional tool measuring + confirm tool lengths
              Two properties (default off). Blum call mirrors shop program O7000.NC:
              G65 P8951 B0. H#3700 with the TLO clears. Turning tools and T99 skipped.
    APW 8.0b  Tool number / offset range limits in settings
              maximumToolNumber, maximumToolLengthOffset, maximumToolDiameterOffset = 99.
              Brother offset variables only cover 1-99; confirmed by O8717 (#16=11000,
              #17=13000). Stock left these undefined, which allowed anything through.
    APW 8.0c  Hard error instead of warning for out-of-range tool numbers and offsets.
              Spindle speed keeps its stock warning-only behaviour.
    APW 8.0d  Shared tool comment builder, buildApwToolComment()
              Header (APW 4.4) and the tool setting block now use one function, so the
              two formats cannot drift. Location field only in the header.
    APW 8.0e  Tool comment order: T## - ID=<prodId> = <desc> - OOH=<len> - HLDR=<holder>
    APW 8.0f  Blum tolerance check, only one T word per cycle
              T positive = dimension tolerance, T negative = position tolerance. The
              manual allows only one; stock emitted both and one check silently vanished.
    APW 8.0g  probeAngleVariables split per probing type
              Stock values were Renishaw only. On Blum #135 is the battery signal and
              #136 is a 4th axis number. Correct Blum results come from O8710 (#111=100)
              and O8700 (#[#111+#10]), so X=#100 Y=#101 angle=#109. UNTESTED.
    APW 8.0h  Block skip gate for the tool setting block
              /GOTO 99999 then an unslashed M00. Skip OFF runs production with no extra
              stop; skip ON gives the operator the choice at the M00.
    APW 8.0i  Required blank line after M00 (CONFIRM TOOL)
              Look ahead evaluated the TLO clear macro statements while the machine was
              still stopped at the M00. Confirmed on the machine. Do not remove.

  V8.1  8/25/26 DWY Post description stamped into the program header, under the machine
                    block, so the NC file records which post built it.

  V8.2  8/25/26 DWY Divider comment line between each tool in the tool setting block.

  V8.3  8/25/26 DWY All probing macro calls output with a leading / so the program can be
                    restarted without re-probing. Set once in writeProbeCycle() and in the
                    protected retract in onCycleEnd() rather than on 40+ individual lines.

  V8.4  8/25/26 DWY Header cosmetics: POST line indented to line up with vendor and model,
                    divider comment above and below the tool list.

  V8.5  8/25/26 DWY Tool length check reworked into a two sided band check, and repeated
                    after every G100 tool change.
                    - New property "Tool length check tolerance", default 0.4.
                    - Band check: alarms if the tool table length is more than the tolerance
                      away from the CAM gauge length in either direction. Catches a wrong
                      tool and an unset tool, which reads as zero.
                    - Uses #3000 (alarm, must be reset) instead of #3006 (stop with message,
                      which the operator can simply run past).
                    - The control has no IF/THEN, see NC Programming manual 6.4.2, so the
                      check needs labels. Tool setting block uses 99000+tool / 99100+tool.
                      The after tool change copies use a running counter from 98000 / 98500
                      because one tool can be called more than once per program.
                    - The after tool change copies are NOT block skipped, so a restart still
                      catches a tool that was swapped out.

  V8.6  8/25/26 DWY Tool length check moved inline, directly after each tool's touch off in
                    the tool setting block, so each tool reads as one self contained chunk.
                    Was previously a separate pass after all tools had been measured.

  V8.6.1 8/25/26 DWY Reworded the tool setting confirm stop to "CONFIRM CORRECT TOOL AND
                    HOLDER AND OOH IS IN SPINDLE".

  V8.7  8/25/26 DWY Re-allocated the tool length check label ranges so they scale past 99
                    tools on the D control. Each range now reserves a full thousand:
                    96000+n / 97000+n after tool change, 98000+t / 99000+t in the tool
                    setting block. Added a post error if a label ever lands on 99999.
                    NOTE: tool numbers above 99 are still blocked by APW 8.0b, and the
                    #11000+n tool length variable range would need verifying on the D
                    control before that limit is raised.

  V8.8  8/25/26 DWY Tools with a cutting diameter larger than the Z-Nano probe disc are no
                    longer touched off automatically. The TLO clear and the P8951 call are
                    replaced by comments explaining why and pointing at O7001 for manual
                    measurement. The tool is still loaded and the confirm stop still runs,
                    so the operator can measure it by hand at that point. Threshold is
                    measureToolMaxDiameter, still a provisional 20mm.

  V8.8.1 8/25/26 DWY Section layout:
                    - Tool length check moved to BEFORE the tool call instead of after it.
                      G100 applies the length offset and moves Z in the same block, so the
                      old position let the machine move on a bad offset before the check ran.
                    - Divider comment at the top of every section.
                    - operation-comment moved down to sit with the job description and the
                      toolpath type, just above the tool call.

  V8.8.2 8/25/26 DWY Blank line after the tool length check, between it and the tool
                    comments. Added at the call site in onSection() rather than inside
                    writeToolLengthCheck(), because the tool setting block already writes
                    its own blank line before the next tool and would end up with two.

  V8.9  10/21/26 DWY M159 after every M00 in the tool setting block.
                    M159 prohibits reading the program ahead until the current operation
                    completes (C Control NC Programming manual 12.3.6). This is the proper
                    fix for the look ahead problem that APW 8.0i patched with a blank line:
                    the TLO clear blocks are macro statements and were being evaluated while
                    the machine was still stopped at the M00. Blum use M159 the same way
                    throughout O8708 and O8716. The blank line from APW 8.0i is kept as well.
                    The M159 after the unslashed gate M00 is itself unslashed; the ones after
                    the per tool confirm stop and the ready to run stop are slashed with them.

  V8.9.1 11/2/26 DWY T#/H# match check (APW 4.7a) now skipped for turning tools, which
                    have no H length offset and were failing the post.

  Open items:
    - Measure the Z-Nano probe disc diameter to set measureToolMaxDiameter and enable R.
    - Verify #109 holds the angle result before trusting APW 8.0g.
    - confirmToolLengths is not inside the block skip gate yet, and may hit the same look
      ahead issue as APW 8.0i since its blocks are all macro statements.
*/

description = "Brother Speedio M Series - APW v8.9.1";
vendor = "Brother - APW";
vendorUrl = "http://www.brother.com";
legal = "Copyright (C) 2012-2026 by Autodesk, Inc.";
certificationLevel = 2;
minimumRevision = 45917;

longDescription = "Generic multi tasking post for Brother Speedio M Series (M140, M200 and M300)." + EOL +
  "Use Turret 0/1 for +X axis turning." + EOL + "Turret 202 for +Y axis turning." + EOL + "Turret 203 for -X axis turning." +
  EOL + "Turret 204 for -Y axis turning." + EOL + "and Turret 205 for A90 +Y axis turning.";

extension = "NC";
programNameIsInteger = false;
setCodePage("ascii");

capabilities = CAPABILITY_MILLING | CAPABILITY_TURNING | CAPABILITY_MACHINE_SIMULATION;
tolerance = spatial(0.002, MM);
if (typeof revision == "number" && typeof supportedFeatures != "undefined") {
  supportedFeatures |= revision >= 50328 ? FEATURE_MACHINE_ROTARY_ANGLES : 0;
}

minimumChordLength = spatial(0.25, MM);
minimumCircularRadius = spatial(0.01, MM);
maximumCircularRadius = spatial(1000, MM);
minimumCircularSweep = toRad(0.01);
maximumCircularSweep = toRad(180);
allowHelicalMoves = true;
allowedCircularPlanes = undefined;
highFeedrate = (unit == MM) ? 5000 : 200;
probeMultipleFeatures = true;

// user-defined properties
properties = {
  preloadTool: {
    title      : "Preload tool",
    description: "Preloads the next tool at a tool change (if any).",
    group      : "preferences",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  showSequenceNumbers: {
    title      : "Use sequence numbers",
    description: "'Yes' outputs sequence numbers on each block, 'Only on tool change' outputs sequence numbers on tool change blocks only, and 'No' disables the output of sequence numbers.",
    group      : "formats",
    type       : "enum",
    values     : [
      {title:"Yes", id:"true"},
      {title:"No", id:"false"},
      {title:"Only on tool change", id:"toolChange"}
    ],
    value: "toolChange",
    order: 1,
    scope: "post"
  },
  sequenceNumberStart: {
    title      : "Start sequence number",
    description: "The number at which to start the sequence numbers.",
    group      : "formats",
    type       : "integer",
    value      : 10,
    order      : 2,
    scope      : "post"
  },
  sequenceNumberIncrement: {
    title      : "Sequence number increment",
    description: "The amount by which the sequence number is incremented by in each block.",
    group      : "formats",
    type       : "integer",
    value      : 5,
    order      : 3,
    scope      : "post"
  },
  optionalStop: {
    title      : "Optional stop",
    description: "Outputs optional stop code during when necessary in the code.",
    group      : "preferences",
    type       : "boolean",
    value      : true,
    scope      : "post"
  },
  separateWordsWithSpace: {
    title      : "Separate words with space",
    description: "Adds spaces between words if 'yes' is selected.",
    group      : "formats",
    type       : "boolean",
    value      : true,
    scope      : "post"
  },
  useRadius: {
    title      : "Radius arcs",
    description: "If yes is selected, arcs are outputted using radius values rather than IJK.",
    group      : "preferences",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  showNotes: {
    title      : "Show notes",
    description: "Writes operation notes as comments in the outputted code.",
    group      : "formats",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  probingType: {
    title      : "Probing type",
    description: "Specified what probing cycles are used on the machine.",
    group      : "probing",
    type       : "enum",
    values     : [
      {title:"Renishaw", id:"Renishaw"},
      {title:"Blum", id:"Blum"}
    ],
    value: "Blum", // APW: default changed from Renishaw DWY
    scope: "post"
  },
  // >>> APW 4.2  Blum work-offset probe shift  (X/I=#190  Y/J=#191  Z/K=#192) DWY
  probeShiftX: {
    title      : "Probe Shift in X / I",
    description: "Will output Shift X Value to shift workoffset in X when probing",
    group      : "probing",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  ShiftXValue: {
    title      : "Amount to Shift in X / I",
    description: "Amount to Shift in X when probing if Probe Shift X is True",
    group      : "probing",
    type       : "number",
    value      : 0,
    scope      : "post"
  },
  probeShiftY: {
    title      : "Probe Shift in Y / J",
    description: "Will output Shift Y Value to shift workoffset in Y when probing",
    group      : "probing",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  ShiftYValue: {
    title      : "Amount to Shift in Y / J",
    description: "Amount to Shift in Y when probing if Probe Shift Y is True",
    group      : "probing",
    type       : "number",
    value      : 0,
    scope      : "post"
  },
  probeShiftZ: {
    title      : "Probe Shift in Z / K",
    description: "Will output Shift Z Value to shift workoffset in Z when probing",
    group      : "probing",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  ShiftZValue: {
    title      : "Amount to Shift in Z / K",
    description: "Amount to Shift in Z when probing if Probe Shift Z is True",
    group      : "probing",
    type       : "number",
    value      : 0,
    scope      : "post"
  },
  // <<< APW 4.2
  useSimpleThread: {
    title      : "Use simple threading cycle",
    description: "Enable to output G392 simple threading cycle, disable to output G376 standard threading cycle.",
    group      : "preferences",
    type       : "boolean",
    value      : true,
    scope      : "post"
  },
  washdownCoolant: {
    title      : "Washdown coolant",
    description: "Specifies whether washdown coolant should be used and where it is output.",
    group      : "preferences",
    type       : "enum",
    values     : [
      {title:"Off", id:"off"},
      {title:"Always on", id:"always"},
      {title:"End of operation", id:"operationEnd"},
      {title:"Program end", id:"programEnd"}
    ],
    value: "off",
    scope: "post"
  },
  usePitchForTapping: {
    title      : "Use Pitch/TPI for tapping",
    description: "Enables the use of pitch and threads per inch instead of feed for tapping cycles. Using G77/78 instead of G84/74.",
    group      : "preferences",
    type       : "boolean",
    value      : true,
    scope      : "post"
  },
  doubleTapWithdrawSpeed: {
    title      : "Double the tap withdraw speed",
    description: "If enabled, an L value containing double the spindle speed (up to 6000) will be output in the G77 tapping cycle.",
    group      : "preferences",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  useClampCodes: {
    title      : "Use clamp codes",
    description: "Specifies whether clamp codes for rotary axes should be output. For simultaneous toolpaths rotary axes will always get unclamped.",
    group      : "multiAxis",
    type       : "boolean",
    value      : true, // DWY was false
    scope      : "post"
  },
  smoothingMode: {
    title      : "High accuracy mode",
    description: "Select the high accuracy mode supported by the control.",
    group      : "preferences",
    type       : "enum",
    values     : [
      {title:"A", id:"A"},
      {title:"B", id:"B"},
      {title:"M298", id:"M298"}
    ],
    value: "M298" // APW: default changed from A DWY
  },
  useTiltedWorkplane: {
    title      : "Use G68.2",
    description: "Enable to use G68.2 for 3+2 operations.",
    group      : "multiAxis",
    type       : "boolean",
    value      : true,
    scope      : "machine"
  },
  maximumTurningSpeed: {
    title      : "Maximum turning speed",
    description: "The maximum turning speed for the C-axis.",
    group      : "preferences",
    type       : "integer",
    value      : 1500, // APW: was 2000 DWY
    scope      : "machine"
  },
  useSmoothing: {
    title      : "High accuracy level",
    description: "Select the high accuracy level to use for machining.",
    group      : "preferences",
    type       : "enum",
    values     : [
      {title:"Off", id:"-1"},
      {title:"Automatic", id:"9999"},
      {title:"Standard", id:"0"}, // 0
      {title:"Roughing", id:"1"}, // 5
      {title:"Medium rough", id:"2"}, // 3
      {title:"Medium rough high", id:"3"}, // 4
      {title:"Finishing", id:"4"}, // 1
      {title:"Finishing high", id:"5"} // 2
    ],
    value: "9999" // APW: default Automatic, was Off (-1) DWY
  },
  useMachiningLoadMonitor: {
    title      : "Machining Load Monitor",
    description: "Specifies if the Machining Load Monitor code (M341/M342/M343) should be output in nc code.",
    group      : "preferences",
    type       : "enum",
    values     : [
      {title:"Off", id:"-1"},
      {title:"M341 ON", id:"341"},
      {title:"M342 ON-MAX ONLY", id:"342"},
      {title:"M343 ON-MIN ONLY", id:"343"},
    ],
    value: "-1",
    scope: "post"
  },
  xHomePosition: {
    title      : "X-axis home position",
    description: "Define the X home position to move to at end of program.",
    group      : "homePositions",
    type       : "spatial",
    value      : 0,
    scope      : "post"
  },
  safePositionMethod: {
    title      : "Safe Retracts",
    description: "Select your desired retract option. 'Clearance Height' retracts to the operation clearance height.",
    group      : "homePositions",
    type       : "enum",
    values     : [
      {title:"G53", id:"G53"},
      {title:"Clearance Height", id:"clearanceHeight"}
    ],
    value: "G53",
    scope: "post"
  },
  singleResultsFile: {
    title      : "Create single results file",
    description: "Set to false if you want to store the measurement results for each probe / inspection toolpath in a separate file",
    group      : "probing",
    type       : "boolean",
    value      : true,
    scope      : "post"
  },
  // DWY >>> APW 8.0a  tool measuring properties (ported from Hi-Fly CNC Speedio post)
  measureTools: {
    title      : "Optionally measure tools at start",
    description: "Measure each milling tool used at the beginning of the program when block delete is turned off. Turning tools and the probe are always skipped.",
    group      : "probing",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  toolLengthTolerance: {
    title      : "Tool length check tolerance",
    description: "Plus/minus band, in the program units, used by the tool length check. The tool table length must fall within this much of the CAM gauge length or the program alarms out. Deliberately wide to catch a wrong or unset tool, not to police stickout.",
    group      : "probing",
    type       : "number",
    value      : 0.4,
    scope      : "post"
  },
  confirmToolLengths: {
    title      : "Confirm tool lengths",
    description: "Check the tool table length against the CAM gauge length, both in the tool setting block and after every tool change. Alarms if a tool is outside the tolerance band. Comment and alarm only - no machine motion.",
    group      : "probing",
    type       : "boolean",
    value      : false,
    scope      : "post"
  },
  // <<< APW 8.0a
  fixtureInfo: {
  title      : "Fixture Info (script-set, do not edit)",
  description: "Set automatically by the fixture-reading script.",
  group      : "preferences",
  type       : "string",
  value      : "",
  scope      : "post"
 }
};

// wcs definiton
wcsDefinitions = {
  useZeroOffset: false,
  wcs          : [
    {name:"Standard", format:"G", range:[54, 59]},
    {name:"Extended", format:"G54.1 P", range:[1, 300]}
  ]
};

var gFormat = createFormat({prefix:"G", minDigitsLeft:2, decimals:1});
var mFormat = createFormat({prefix:"M", minDigitsLeft:2, decimals:1});
var hFormat = createFormat({prefix:"H", minDigitsLeft:2, decimals:1});
var diameterOffsetFormat = createFormat({prefix:"D", minDigitsLeft:2, decimals:1});
var pFormat = createFormat({prefix:"P", decimals:1});
var integerFormat = createFormat({decimals:0});
var probeWCSFormat = createFormat({decimals:0, type:FORMAT_REAL});
var probeExtWCSFormat = createFormat({prefix:"S", decimals:0, type:FORMAT_REAL, offset:100});

var xyzFormat = createFormat({decimals:(unit == MM ? 3 : 4)});
var ijkFormat = createFormat({decimals:6, type:FORMAT_REAL}); // unitless
var xFormat = createFormat({decimals:(unit == MM ? 3 : 4)});
var yFormat = createFormat({decimals:(unit == MM ? 3 : 4)});
var rFormat = xyzFormat; // radius
var abcFormat = createFormat({decimals:3, type:FORMAT_REAL, scale:DEG});
var feedFormat = createFormat({decimals:(unit == MM ? 3 : 4)});
var pitchFormat = createFormat({decimals:4});
var threadPQFormat = createFormat({decimals:0, type:FORMAT_LZS, scale:(unit == MM ? 11000 : 110000)});
var inverseTimeFormat = createFormat({decimals:3, type:FORMAT_REAL});
var toolFormat = createFormat({minDigitsLeft:2, decimals:1});
var rpmFormat = createFormat({decimals:0});
var secFormat = createFormat({decimals:3, type:FORMAT_REAL}); // seconds - range 0.001-99999.999
var taperFormat = createFormat({decimals:1, scale:DEG});

// DWY >>> APW 8.0a  tool measuring globals
//   measureToolMaxDiameter: the Blum Z-Nano probe disc diameter. A tool whose cutting
//   diameter is larger than the disc cannot be touched off on centre, because the centre of
//   the tool sits over the middle of the disc where there may be no cutting edge, and the
//   outer edges hang off the disc entirely. Those tools are skipped by the automatic touch
//   off (APW 8.8) and left for manual measurement.
//   PROVISIONAL VALUE - measure the actual disc and update this. Too small and good tools
//   get skipped; too large and an oversized tool gets a bad length.
measureToolMaxDiameter = toPreciseUnit(20, MM);
measureProbe           = false;                 // never send the spindle probe to the tool setter
//   spindleProbeToolNumber: shop standard - T99 is the spindle probe on every machine.
//   It is skipped by tool NUMBER, not by CAM tool type, so it stays protected even if the
//   tool is built in CAM as an ordinary mill. Never send it to the tool setter and never
//   length-check it. Note the Blum calibration cycle P8950 also uses H99/D99.
var spindleProbeToolNumber = 99;
//   measureToolsSkipLabel: sequence number used to jump PAST the tool setting block on a
//   normal production run. Must be a number that never appears as a real N word in the
//   program. Brother sequence numbers are 5 digits (N1-N99999), so 99999 is the top of the
//   range and safely out of the way. Do not raise it to 6 digits.
var measureToolsSkipLabel = 99999;
//   measureToolsSeparator: visual divider between tools in the tool setting block, so each
//   tool reads as its own chunk on the control. Plain hyphens on purpose - only the
//   characters in settings.comments.permittedCommentChars survive writeComment(), and an
//   em dash is not one of them. It would be silently stripped, leaving an empty comment.
var measureToolsSeparator = "--------------------------------------------";
//   Label ranges for the tool length checks (APW 8.5, re-allocated in APW 8.7).
//   Sequence numbers are 1-99999 on this control (NC Programming manual 6.4.2), and every
//   check needs two labels. The tool setting block derives its labels from the TOOL NUMBER
//   so they stay readable, which means each range has to be wide enough for the largest
//   tool number the machine could ever use. The C control is limited to 99 tools, but the
//   D control can go higher, so the ranges below reserve a full thousand each rather than
//   the hundred the old 99000/99100 split allowed:
//
//       96000 + n   after tool change, alarm     (n = running counter)
//       97000 + n   after tool change, pass
//       98000 + t   tool setting block, alarm    (t = tool number)
//       99000 + t   tool setting block, pass
//       99999       tool setting block skip label (APW 8.0h)
//
//   The after tool change checks use a running counter, not the tool number, because one
//   tool can be called several times in a program and a duplicate label would make GOTO
//   jump to the first match and report the wrong tool.
var toolChangeCheckCounter = 0;
var toolChangeCheckAlarmBase = 96000;
var toolChangeCheckPassBase = 97000;
var toolSettingCheckAlarmBase = 98000;
var toolSettingCheckPassBase = 99000;
var measureTool        = false;                 // set true to append a measure block to the next tool call
// <<< APW 8.0a

var xOutput = createOutputVariable({onchange:function() {state.retractedX = false;}, prefix:"X"}, xyzFormat);
var yOutput = createOutputVariable({onchange:function() {state.retractedY = false;}, prefix:"Y"}, xyzFormat);
var zOutput = createOutputVariable({onchange:function() {state.retractedZ = false;}, prefix:"Z"}, xyzFormat);
var toolVectorOutputI = createOutputVariable({prefix:"I", control:CONTROL_FORCE}, ijkFormat);
var toolVectorOutputJ = createOutputVariable({prefix:"J", control:CONTROL_FORCE}, ijkFormat);
var toolVectorOutputK = createOutputVariable({prefix:"K", control:CONTROL_FORCE}, ijkFormat);
var aOutput = createOutputVariable({prefix:"A"}, abcFormat);
var bOutput = createOutputVariable({prefix:"B"}, abcFormat);
var cOutput = createOutputVariable({prefix:"C"}, abcFormat);
var feedOutput = createOutputVariable({prefix:"F"}, feedFormat);
var inverseTimeOutput = createOutputVariable({prefix:"F", control:CONTROL_FORCE}, inverseTimeFormat);
var pitchOutput = createOutputVariable({prefix:"F"}, pitchFormat);
var cyclefeedOutput = createOutputVariable({prefix:"F", control:CONTROL_FORCE}, feedFormat);
var sOutput = createOutputVariable({prefix:"S", control:CONTROL_FORCE}, rpmFormat);
var qOutput = createOutputVariable({prefix:"Q", control:CONTROL_FORCE}, rpmFormat);
var pOutput = createOutputVariable({control:CONTROL_FORCE}, pFormat);
var threadROutput = createOutputVariable({prefix:"R", control:CONTROL_FORCE}, threadPQFormat);
var g92ROutput = createOutputVariable({prefix:"R"}, xyzFormat);
var g92QOutput = createOutputVariable({prefix:"Q"}, xyzFormat);

// circular output
var iOutput = createOutputVariable({prefix:"I", control:CONTROL_NONZERO}, xyzFormat);
var jOutput = createOutputVariable({prefix:"J", control:CONTROL_NONZERO}, xyzFormat);
var kOutput = createOutputVariable({prefix:"K", control:CONTROL_NONZERO}, xyzFormat);

var gMotionModal = createOutputVariable({}, gFormat); // modal group 1 // G0-G3, ...
var gPlaneModal = createOutputVariable({onchange:function () {gMotionModal.reset();}}, gFormat); // modal group 2 // G17-19
var gAbsIncModal = createOutputVariable({}, gFormat); // modal group 3 // G90-91
var gFeedModeModal = createOutputVariable({}, gFormat); // modal group 5 // G94-95
var gSpindleModeModal = createOutputVariable({}, gFormat); // modal group 5 // G96-97
var gUnitModal = createOutputVariable({}, gFormat); // modal group 6 // G20-21
var gCycleModal = createOutputVariable({control:CONTROL_FORCE}, gFormat); // modal group 9 // G81, ...
var gRetractModal = createOutputVariable({}, gFormat); // modal group 10 // G98-99
var gInfeedModal = createOutputVariable({}, gFormat); // G321-G323
var mTurningModal = createOutputVariable({}, mFormat);
var fourthAxisClamp = createOutputVariable({}, mFormat);
var fifthAxisClamp = createOutputVariable({}, mFormat);
var sixthAxisClamp = createOutputVariable({}, mFormat);
var washdownModal = createOutputVariable({}, mFormat);
var machineLoadMonitorOutput = createOutputVariable({current:340}, mFormat);

var settings = {
  coolant: {
    // samples:
    // {id: COOLANT_THROUGH_TOOL, on: 88, off: 89}
    // {id: COOLANT_THROUGH_TOOL, on: [8, 88], off: [9, 89]}
    // {id: COOLANT_THROUGH_TOOL, on: "M88 P3 (myComment)", off: "M89"}
    coolants: [
      {id:COOLANT_FLOOD, on:8},
      {id:COOLANT_MIST},
      {id:COOLANT_THROUGH_TOOL, on:494, off:495},
      {id:COOLANT_AIR},
      {id:COOLANT_AIR_THROUGH_TOOL},
      {id:COOLANT_SUCTION},
      {id:COOLANT_FLOOD_MIST},
      {id:COOLANT_FLOOD_THROUGH_TOOL, on:[8, 494], off:[9, 495]},
      {id:COOLANT_OFF, off:9}
    ],
    singleLineCoolant: false, // specifies to output multiple coolant codes in one line rather than in separate lines
  },
  smoothing: {
    roughing              : 2, // roughing level for smoothing in automatic mode
    semi                  : 3, // semi-roughing level for smoothing in automatic mode
    semifinishing         : 4, // semi-finishing level for smoothing in automatic mode
    finishing             : 5, // finishing level for smoothing in automatic mode
    thresholdRoughing     : toPreciseUnit(0.5, MM), // operations with stock/tolerance above that threshold will use roughing level in automatic mode
    thresholdFinishing    : toPreciseUnit(0.05, MM), // operations with stock/tolerance below that threshold will use finishing level in automatic mode
    thresholdSemiFinishing: toPreciseUnit(0.1, MM), // operations with stock/tolerance above finishing and below threshold roughing that threshold will use semi finishing level in automatic mode

    differenceCriteria: "level", // options: "level", "tolerance", "both". Specifies criteria when output smoothing codes
    autoLevelCriteria : "stock", // use "stock" or "tolerance" to determine levels in automatic mode
    cancelCompensation: false // tool length compensation must be canceled prior to changing the smoothing level
  },
  retract: {
    cancelRotationOnRetracting: false, // specifies that rotations (G68) need to be canceled prior to retracting
    methodXY                  : undefined, // special condition, overwrite retract behavior per axis
    methodZ                   : "G28", // special condition, overwrite retract behavior per axis
    useZeroValues             : ["G28", "G30"], // enter property value id(s) for using "0" value instead of machineConfiguration axes home position values (ie G30 Z0)
    homeXY                    : {onIndexing:false, onToolChange:false, onProgramEnd:{axes:[X, Y]}} // Specifies when XY should be homed in XY (sample: onIndexing:[X,Y]). Options can be combined
  },
  parametricFeeds: {
    firstFeedParameter    : 500, // specifies the initial parameter number to be used for parametric feedrate output
    feedAssignmentVariable: "#", // specifies the syntax to define a parameter
    feedOutputVariable    : "F#" // specifies the syntax to output the feedrate as parameter
  },
  machineAngles: { // refer to https://cam.autodesk.com/posts/reference/classMachineConfiguration.html#a14bcc7550639c482492b4ad05b1580c8
    controllingAxis: ABC,
    type           : PREFER_PREFERENCE,
    options        : ENABLE_ALL
  },
  workPlaneMethod: {
    useTiltedWorkplane    : true, // specifies that tilted workplanes should be used (ie. G68.2, G254, PLANE SPATIAL, CYCLE800), can be overwritten by property
    eulerConvention       : EULER_ZXZ_R, // specifies the euler convention (ie EULER_XYZ_R), set to undefined to use machine angles for TWP commands ('undefined' requires machine configuration)
    eulerCalculationMethod: "standard", // ('standard' / 'machine') 'machine' adjusts euler angles to match the machines ABC orientation, machine configuration required
    cancelTiltFirst       : true, // cancel tilted workplane prior to WCS (G54-G59) blocks
    forceMultiAxisIndexing: false, // force multi-axis indexing for 3D programs
    optimizeType          : OPTIMIZE_AXIS, // can be set to OPTIMIZE_NONE, OPTIMIZE_BOTH, OPTIMIZE_TABLES, OPTIMIZE_HEADS, OPTIMIZE_AXIS. 'undefined' uses legacy rotations
    prepositionWithTWP    : true, // Use tilted workplane commands for multi axis toolpath prepositioning
  },
  comments: {
    permittedCommentChars: " abcdefghijklmnopqrstuvwxyz0123456789.,=_-+/?*", // DWY APW:  added + / ? *  -- letters are not case sensitive, use option 'outputFormat' below. Set to 'undefined' to allow any character
    prefix               : "(", // specifies the prefix for the comment
    suffix               : ")", // specifies the suffix for the comment
    outputFormat         : "upperCase", // can be set to "upperCase", "lowerCase" and "ignoreCase". Set to "ignoreCase" to write comments without upper/lower case formatting
    maximumLineLength    : 110 // DWY APW: was 80 // the maximum number of characters allowed in a line, set to 0 to disable comment output
  },
  probing: {
    macroCall              : gFormat.format(65), // specifies the command to call a macro
    probeAngleMethod       : undefined, // supported options are: OFF, AXIS_ROT, G68, G54.4. 'undefined' uses automatic selection
    // DWY >>> APW 8.0g  angle compensation variables, split per probing type.
    //
    //   Stock had a single set of variables here, and they are the RENISHAW ones. With
    //   "Probing type" set to Blum they point at completely unrelated data on our control:
    //   per the Blum applications manual parameter table, #135 is the BATTERY input signal
    //   and #136 is the number and direction of a fourth axis. Feeding those into the angle
    //   compensation would rotate the coordinate system by a meaningless number, silently.
    //
    //   The correct Blum values come from our own machine programs, not from the manual
    //   alone. O8710 (USERPARATAB) sets:  #111=100 (STARTADRESS 10 RESULT)
    //   and O8700 clears the results with  #[#111+#10]=#0  for #10 = 0..9.
    //   So the manual's "#111+n" notation resolves on this machine to #100 through #109:
    //       #100 = X result        #101 = Y result        #102 = Z result
    //       #109 = angle measurement result
    //   Only x, y and r are results. z/i/j/k stay as-is: they are not measurements, they
    //   define the rotation axis for G68 (rotate about Z through the measured X,Y point).
    //
    //   NOTE: the Hi-Fly post used r:"#143" for Blum. That does not match our O8710, which
    //   puts the angle result at #109. Ours wins.
    //
    //   UNTESTED: we do not currently run angular probing, so there is no known good output
    //   to compare against. Before trusting this, run a probe by hand and read #109 on the
    //   control to confirm it holds the measured angle.
    probeAngleVariables    : {
      Renishaw: {x:"#135", y:"#136", z:0, i:0, j:0, k:1, r:"#144", baseParamG54x4:26000, baseParamAxisRot:5200, method:0}, // method 0 = Fanuc, 1 = Haas
      Blum    : {x:"#100", y:"#101", z:0, i:0, j:0, k:1, r:"#109", baseParamG54x4:26000, baseParamAxisRot:5200, method:0}
    },
    // <<< APW 8.0g
    allowIndexingWCSProbing: false // specifies that probe WCS with tool orientation is supported
  },
  maximumSequenceNumber: undefined, // the maximum sequence number (Nxxx), use 'undefined' for unlimited
  // DWY >>> APW 8.0b  Brother tool offset system variables only cover tools 1-99:
  //   #11001-#11099 tool length geometry, #10001-#10099 tool length wear,
  //   #13001-#13099 cutter comp geometry, #12001-#12099 tool diameter wear.
  //   A tool number above 99 builds a valid but WRONG variable (T100 -> #11100) with no
  //   alarm at the control, so the post must fail instead. Stock left these undefined,
  //   which fell back to a 99999 limit and let anything through.
  maximumToolNumber        : 99,
  maximumToolLengthOffset  : 99,
  maximumToolDiameterOffset: 99,
  // <<< APW 8.0b
  polarCycleExpandMode : 1 // 0=EXPAND_NONE: Does not expand any cycles. 1=EXPAND_TCP: Expands drilling cycles, when TCP is on. 2=EXPAND_NON_TCP: Expands drilling cycles, when TCP is off. 3=EXPAND_ALL: Expands all drilling cycles
};

var washdownCoolant = {on:400, off:401};
var currentToolNumber = undefined;

var probeVariables = {
  outputRotationCodes: false, // determines if it is required to output rotation codes
  compensationXY     : undefined,
  probeAngleMethod   : undefined
};

// fixed settings
var maximumTurningSpeed;
var machineState = {
  isTurningOperation: false,
  feedMode          : undefined,
  isTurningYAxis    : false,
  turningAngle      : 0,
  speedControlAxis  : undefined
};

function onOpen() {
  // define and enable machine configuration
  receivedMachineConfiguration = machineConfiguration.isReceived();

  if (!receivedMachineConfiguration || !machineConfiguration.isMultiAxisConfiguration()) {
    error(localize("This post processor requires a multiaxis machine configuration. Use Brother Speedio M Series machine configuration form the machine library." + EOL +
    "Visit https://cam.autodesk.com/posts/posts/guides/Brother_Multi_Tasking_Post_Guide.pdf to learn more on how to use this post with Fusion."));
  }
  if (machineConfiguration.isHeadConfiguration()) {
    error(localize("This post processor does not support head configuration machines."));
  }

  activateMachine(); // enable the machine optimizations and settings

  setAllowedCircularPlanes(-1);
  maximumTurningSpeed = getProperty("maximumTurningSpeed");
  if (getProperty("useRadius")) {
    maximumCircularSweep = toRad(90); // avoid potential center calculation errors for CNC
  }

  washdownModal.format(washdownCoolant.off);
  // setup for proper smoothing mode
  switch (getProperty("smoothingMode")) {
  case "A":
  case "B":
    settings.smoothing.roughing = 5;
    settings.smoothing.semi = 3;
    settings.smoothing.semifinishing = 1;
    settings.smoothing.finishing = 2;
    break;
  }
  fourthAxisClamp.format(443); // Default 4th axis modal code to be clamped
  fifthAxisClamp.format(441); // Default 5th axis modal code to be clamped
  sixthAxisClamp.format(445); // Default 6th axis modal code to be clamped

  if (programName) {
    writeComment(programName + conditional(programComment, SP + formatComment(programComment)));
  } else {
    error(localize("Program name has not been specified."));
  }
  writeProgramHeader();
  writeMeasureTools(); // DWY APW 8.0a

  if (typeof inspectionWriteVariables == "function") {
    inspectionWriteVariables();
  }

  // absolute coordinates and feed per min
  writeBlock(gMotionModal.format(0), gAbsIncModal.format(90), gFormat.format(40), gFormat.format(80));
  writeBlock(gFeedModeModal.format(94), lengthCompOutput.format(lengthCompCodes.cancel), gSpindleModeModal.format(97), gPlaneModal.format(17));

  // DWY APW 4.7c  unit warning comment removed
  // writeComment("File output in " + (unit == MM ? "MM" : "inches") + ". Please ensure the unit is set correctly on the control");
  validateCommonParameters();
  validateTurningSpindleSpeed();
}

/*. DWY OG unchanged
function setSmoothing(mode) {
  if (mode == smoothing.isActive && (!mode || !smoothing.isDifferent) && !smoothing.force) {
    return; // return if smoothing is already active or is not different
  }
  if (validateLengthCompensation && settings.smoothing.cancelCompensation) {
    validate(!state.lengthCompensationActive, "Length compensation is active while trying to update smoothing.");
  }
  if (getProperty("smoothingMode") !== "B" && tcp.isSupportedByOperation) {
    error(localize("The 'High accuracy mode' property set to mode '" +
      getProperty("smoothingMode") + "' cannot be used with TCP (G43.4). Use mode 'B' for compatibility."));
  }
  // for smoothingModes A and B mapping is required for smoothing level value
  var propertyBaseLevel = parseInt(getProperty("useSmoothing"), 10);
  propertyBaseLevel = isNaN(propertyBaseLevel) ? -1 : propertyBaseLevel;
  var mappedLevel = (propertyBaseLevel >= 0 && propertyBaseLevel <= 5) ? [0, 5, 3, 4, 1, 2][propertyBaseLevel] : smoothing.level;
  switch (getProperty("smoothingMode")) {
  case "A":
    writeBlock(mFormat.format(mode ? 260 + mappedLevel : 269));
    break;
  case "B":
    writeBlock(mFormat.format(mode ? 280 + mappedLevel : 289));
    break;
  default:
    writeBlock(mFormat.format(mode ? 298 : 299), mode ? "L" + smoothing.level : "");
    break;
  }
  smoothing.isActive = mode;
  smoothing.force = false;
  smoothing.isDifferent = false;
}
*/ //END
// DWY NEW
function setSmoothing(mode) {
  if (mode == smoothing.isActive && (!mode || !smoothing.isDifferent) && !smoothing.force) {
    return;
  }

  // APW: TCP (G43.4) active + non-B mode -> skip activation instead of erroring.
  // State is left "off" so smoothing re-activates once TCP is no longer active.
  if (mode && getProperty("smoothingMode") !== "B" && tcp.isSupportedByOperation) {
    smoothing.isActive = false;
    smoothing.force = false;
    smoothing.isDifferent = false;
    return;
  }

  if (validateLengthCompensation && settings.smoothing.cancelCompensation) {
    validate(!state.lengthCompensationActive, "Length compensation is active while trying to update smoothing.");
  }
  var propertyBaseLevel = parseInt(getProperty("useSmoothing"), 10);
  propertyBaseLevel = isNaN(propertyBaseLevel) ? -1 : propertyBaseLevel;
  var mappedLevel = (propertyBaseLevel >= 0 && propertyBaseLevel <= 5) ? [0, 5, 3, 4, 1, 2][propertyBaseLevel] : smoothing.level;
  switch (getProperty("smoothingMode")) {
  case "A":
    writeBlock(mFormat.format(mode ? 260 + mappedLevel : 269));
    break;
  case "B":
    writeBlock(mFormat.format(mode ? 280 + mappedLevel : 289));
    break;
  default:
    writeBlock(mFormat.format(mode ? 298 : 299), mode ? "L" + smoothing.level : "");
    break;
  }
  smoothing.isActive = mode;
  smoothing.force = false;
  smoothing.isDifferent = false;
}
// NEW END

function onParameter(name, value) {
}

var reverseCC = false;
function updateMachiningMode(section) {
  machineState.isTurningOperation = (section.getType() == TYPE_TURNING);
  machineState.feedMode = section.feedMode == FEED_PER_REVOLUTION ? 95 : 94;

  if (!machineState.isTurningOperation) {
    setTurningMode(false);
    return;
  }

  reverseCC = false;
  var turret = section.getTool().turret;
  if (turret == 1 || turret == 0) { // Turret 1/0 enables turning along X axis
    machineState.isTurningYAxis = false;
    machineState.turningAngle = 0;
    machineState.speedControlAxis = 1;
    writeComment("TURNING ALONG +X AXIS");
  } else if (turret == 202) { // Turret 202 enables turning along Y axis
    machineState.isTurningYAxis = true;
    machineState.turningAngle = 270;
    machineState.speedControlAxis = 2;
    writeComment("TURNING ALONG +Y AXIS");
  } else if (turret == 203) { // Turret 203 enables turning along -X axis
    machineState.isTurningYAxis = false;
    machineState.turningAngle = 180;
    machineState.speedControlAxis = 1;
    reverseCC = true;
    writeComment("TURNING ALONG -X AXIS");
  } else if (turret == 204) { // Turret 204 enables turning along -Y axis
    machineState.isTurningYAxis = true;
    machineState.turningAngle = 90;
    machineState.speedControlAxis = 2;
    reverseCC = true;
    writeComment("TURNING ALONG -Y AXIS");
  } else if (turret == 205) { // Turret 205 enables turning along X axis with A=90 degrees
    machineState.isTurningYAxis = true;
    machineState.turningAngle = 90; // only allow turning along Y-axis with A=90 degrees
    machineState.speedControlAxis = 3;
    writeComment("TURNING AT A=90 ALONG +Y AXIS");
  } else {
    error(localize("Invalid turret number for turning operation. Visit https://cam.autodesk.com/posts/posts/guides/Brother_Mill_Turn_Post_Guide.pdf to learn more on how to use this post with Fusion."));
  }

  // set turning/milling mode
  setTurningMode(machineState.isTurningOperation);
}

function setTurningMode(mode) {
  if (mode) {
    cOutput.disable();
    var turningCode = mTurningModal.format(142);
    writeBlock(turningCode, conditional(turningCode, formatComment("ENABLE TURNING MODE")));
  } else {
    var millingCode = mTurningModal.format(141);
    cOutput.enable();
    if (millingCode) {
      writeBlock(gSpindleModeModal.format(97));
      writeBlock(millingCode, formatComment("ENABLE MILLING MODE"));
      cOutput.reset();
      onCommand(COMMAND_UNLOCK_MULTI_AXIS);
      writeBlock(gAbsIncModal.format(90), gFormat.format(28), cOutput.format(0));
      var currentDirection = getCurrentDirection();
      setCurrentDirection(new Vector(currentDirection.x, currentDirection.y, 0));
      forceAny();
    }
  }
}

function defineTurningWorkplane(section) {
  var angle = 0; // default A0 direction
  if (section.getTool().turret == 205) {
    angle = Math.PI / 2;
  }

  var direction;
  var abc = new Vector(0, 0, 0);
  if (Vector.dot(machineConfiguration.getAxisU().getAxis(), new Vector(1, 0, 0)) != 0) {
    direction = (machineConfiguration.getAxisU().getAxis().getCoordinate(0) >= 0) ? 1 : -1; // A-axis is the U-axis
    abc = new Vector(angle * direction, 0, toRad(machineState.turningAngle));
  } else {
    direction = (machineConfiguration.getAxisV().getAxis().getCoordinate(0) >= 0) ? 1 : -1; // A-axis is the V-axis
    abc = new Vector(0, angle * direction, toRad(machineState.turningAngle));
  }

  if (settings.workPlaneMethod.optimizeType == undefined) { // legacy
    var useTCP = false;
    var R = machineConfiguration.getRemainingOrientation(abc, section.workPlane);
    setRotation(useTCP ? section.workPlane : R);
  } else {
    if (!section.isOptimizedForMachine()) {
      section.optimize3DPositionsByMachine(machineConfiguration, abc, OPTIMIZE_BOTH); // for turning mode tcp is disabled
    }
  }

  positionABC(abc, false);
  currentWorkPlaneABC = abc;
  onCommand(COMMAND_LOCK_MULTI_AXIS);
  return abc;
}

function getPlaneMode() {
  var plane = 17;
  if (machineState.isTurningOperation) {
    plane = machineState.isTurningYAxis ? 19 : 18;
  }
  return plane;
}

function validateTurningSpindleSpeed() {
  var _maximumSpindleRPM = maximumTurningSpeed;
  var header = ["Detected maximum values are out of range.", "Maximum values:"];
  var warnings = {
    spindleSpeed: {msg:"Turning spindle speed exceeds the maximum value for operation: " + EOL, max:" Turning spindle speed: " + _maximumSpindleRPM, values:[]}
  };

  for (var i = 0; i < getNumberOfSections(); ++i) {
    var section = getSection(i);
    var tool = section.getTool();
    var isTurningOperation = (section.getType() == TYPE_TURNING);
    if (!isTurningOperation) {
      continue;
    }
    var _sectionSpindleSpeed = Math.max((tool.getSpindleMode() == SPINDLE_CONSTANT_SURFACE_SPEED ? section.getTool().maximumSpindleSpeed : tool.spindleRPM), 0);
    if (_sectionSpindleSpeed > _maximumSpindleRPM) {
      warnings.spindleSpeed.values.push(SP + section.getParameter("operation-comment", "") + " (" + _sectionSpindleSpeed + " RPM" + ")" + EOL);
    }
  }
  var warningMessages = [];
  for (var key in warnings) {
    if (warnings[key].values != "") {
      header.push(warnings[key].max); // add affected max values to the header
      warningMessages.push(warnings[key].msg + warnings[key].values.join(""));
    }
  }
  if (warningMessages.length != 0) {
    warningMessages.unshift(header.join(EOL) + EOL);
    warning(warningMessages.join(EOL));
  }
}

var lengthCompCodes = {tool:43, tcp:43.4, tcpVector:43.5, cancel:49};
var lengthCompOutput = createOutputVariable({control : CONTROL_FORCE,
  onchange: function() {
    state.tcpIsActive = lengthCompOutput.getCurrent() == lengthCompCodes.tcp || lengthCompOutput.getCurrent() == lengthCompCodes.tcpVector;
    state.lengthCompensationActive = lengthCompOutput.getCurrent() != lengthCompCodes.cancel;
    machineSimulation({}); // update machine simulation TCP state
  }
}, gFormat);

function getLengthCompCode(forceTCP) {
  if (!getSetting("outputToolLengthCompensation", true) && lengthCompOutput.isEnabled()) {
    state.lengthCompensationActive = true; // always assume that length compensation is active
    lengthCompOutput.disable();
  }
  var lengthCompCode = machineState.isTurningOperation ? 143 : lengthCompCodes.tool;
  if (tcp.isSupportedByOperation || forceTCP) {
    lengthCompCode = machineConfiguration.isMultiAxisConfiguration() ? lengthCompCodes.tcp : lengthCompCodes.tcpVector;
  }
  return lengthCompOutput.format(lengthCompCode);
}

function setTCP(_tcp, force) {
  if (!force && state.tcpIsActive === _tcp) {
    return;
  }
  cancelLengthCompensation();
  if (_tcp) {
    var hOffset = getSetting("outputToolLengthOffset", true) ? hFormat.format(tool.lengthOffset) : "";
    writeBlock(getLengthCompCode(force), hOffset);
    forceXYZ();
  }
}

/** Disables length compensation if currently active or if forced. */
function cancelLengthCompensation(force) {
  if ((state.lengthCompensationActive || force) && !machineState.isTurningOperation) {
    if (force) {
      lengthCompOutput.reset();
    }
    if (!getSetting("allowCancelTCPBeforeRetracting", false)) {
      validate(state.retractedZ, "Cannot cancel tool length compensation if the machine is not fully retracted.");
    }
    writeBlock(lengthCompOutput.format(lengthCompCodes.cancel));
  }
}

function writeInitialPositioning(position, isRequired, codes1, codes2) {
  var motionCode = {single:0, multi:0};
  switch (highFeedMapping) {
  case HIGH_FEED_MAP_ANY:
    motionCode = {single:1, multi:1}; // map all rapid traversals to high feed
    break;
  case HIGH_FEED_MAP_MULTI:
    motionCode = {single:0, multi:1}; // map rapid traversal along more than one axis to high feed
    break;
  }
  var feed = (highFeedMapping != HIGH_FEED_NO_MAPPING) ? getFeed(highFeedrate) : "";
  var hOffset = getSetting("outputToolLengthOffset", true) ? hFormat.format(tool.lengthOffset) : "";
  var additionalCodes = [formatWords(codes1), formatWords(codes2)];

  forceModals(gMotionModal);
  writeStartBlocks(isRequired, function() {
    var modalCodes = formatWords(gAbsIncModal.format(90), gPlaneModal.format(getPlaneMode()));
    if (typeof cancelLengthCompensation == "function") {
      cancelLengthCompensation(!isRequired); // cancel tool length compensation prior to enabling it, required when switching G43/G43.4 modes
    }

    // multi axis prepositioning with TWP
    if (currentSection.isMultiAxis() && getSetting("workPlaneMethod.prepositionWithTWP", true) && getSetting("workPlaneMethod.useTiltedWorkplane", false) &&
      tcp.isSupportedByOperation && getCurrentDirection().isNonZero()) {
      var W = machineConfiguration.isMultiAxisConfiguration() ? machineConfiguration.getOrientation(getCurrentDirection()) :
        Matrix.getOrientationFromDirection(getCurrentDirection());
      var prePosition = W.getTransposed().multiply(position);
      var angles = W.getEuler2(settings.workPlaneMethod.eulerConvention);
      setWorkPlane(angles);
      writeBlock(modalCodes, gMotionModal.format(motionCode.multi), xOutput.format(prePosition.x), yOutput.format(prePosition.y), feed, additionalCodes);
      machineSimulation({x:prePosition.x, y:prePosition.y});
      cancelWorkPlane();
      setTCP(true); // omit Z-axis output is desired
      forceAny(); // required to output XYZ coordinates in the following line
    } else {
      if (machineConfiguration.isHeadConfiguration()) {
        writeBlock(modalCodes, gMotionModal.format(motionCode.multi), getLengthCompCode(),
          xOutput.format(position.x), yOutput.format(position.y), zOutput.format(position.z),
          hOffset, feed, additionalCodes
        );
      } else {
        writeBlock(modalCodes, gMotionModal.format(motionCode.multi), xOutput.format(position.x), yOutput.format(position.y), feed, additionalCodes[0]);
        machineSimulation({x:position.x, y:position.y});
        writeBlock(gMotionModal.format(motionCode.single), getLengthCompCode(), zOutput.format(position.z), hOffset, additionalCodes[1]);
        machineSimulation(tcp.isSupportedByOperation ? {x:position.x, y:position.y, z:position.z} : {z:position.z});
      }
    }
    forceModals(gMotionModal);
    if (isRequired) {
      additionalCodes = []; // clear additionalCodes buffer
    }
  });

  validate(!validateLengthCompensation || state.lengthCompensationActive, "Tool length compensation is not active."); // make sure that lenght compensation is enabled
  if (!isRequired) { // simple positioning
    var modalCodes = formatWords(gAbsIncModal.format(90), gPlaneModal.format(getPlaneMode()));
    forceXYZ();
    if (!state.retractedZ && xyzFormat.getResultingValue(getCurrentPosition().z) < xyzFormat.getResultingValue(position.z)) {
      writeBlock(modalCodes, gMotionModal.format(motionCode.single), zOutput.format(position.z), feed);
      machineSimulation({z:position.z});
    }
    writeBlock(modalCodes, gMotionModal.format(motionCode.multi), xOutput.format(position.x), yOutput.format(position.y), feed, additionalCodes);
    machineSimulation({x:position.x, y:position.y});
  }
}

Matrix.getOrientationFromDirection = function (ijk) {
  var forward = ijk;
  var unitZ = new Vector(0, 0, 1);
  var W;
  if (Math.abs(Vector.dot(forward, unitZ)) < 0.5) {
    var imX = Vector.cross(forward, unitZ).getNormalized();
    W = new Matrix(imX, Vector.cross(forward, imX), forward);
  } else {
    var imX = Vector.cross(new Vector(0, 1, 0), forward).getNormalized();
    W = new Matrix(imX, Vector.cross(forward, imX), forward);
  }
  return W;
};

function startSpindle(tool, insertToolCall) {
  if (tool.type != TOOL_PROBE) {
    var spindleSpeedIsRequired = isSpindleSpeedDifferent() || forceSpindleSpeed || insertToolCall;
    writeStartBlocks(spindleSpeedIsRequired, function () {
      if (spindleSpeedIsRequired || operationNeedsSafeStart) {
        onCommand(COMMAND_START_SPINDLE);
      }
    });
  }
}

function writeToolCall(tool, insertToolCall) {
  if (!isFirstSection()) {
    writeStartBlocks(!getProperty("safeStartAllOperations") && insertToolCall, function () {
      writeRetract(Z); // write optional Z retract before tool change if safeStartAllOperations is enabled
    });
  }
  writeStartBlocks(insertToolCall, function () {
    writeRetract(Z);
    if (getSetting("retract.homeXY.onToolChange", false)) {
      writeRetract(settings.retract.homeXY.onToolChange);
    }
    if (!isFirstSection() && insertToolCall) {
      onCommand(COMMAND_COOLANT_OFF); // turn off coolant on tool change
      if (typeof cancelLengthCompensation == "function") {
        cancelLengthCompensation();
      }
    }
    if (tool.manualToolChange) {
      onCommand(COMMAND_STOP);
      writeComment("MANUAL TOOL CHANGE TO T" + toolFormat.format(tool.number));
    } else {
      if (!isFirstSection() && getProperty("optionalStop") && insertToolCall) {
        onCommand(COMMAND_OPTIONAL_STOP);
      }
      onCommand(COMMAND_LOAD_TOOL);
    }
  });
}

function getSpindleDirection(tool) {
  return machineState.isTurningOperation ? tool.clockwise ? 303 : 304 : tool.clockwise ? 3 : 4;
}

function printProbeResults() {
  return ((currentSection.getParameter("printResults", 0) == 1) && (getProperty("probingType") == "Renishaw"));
}

function onSection() {
  var forceSectionRestart = optionalSection && !currentSection.isOptional();
  optionalSection = currentSection.isOptional();
  var insertToolCall = isToolChangeNeeded("number") || forceSectionRestart;
  var newWorkOffset = isNewWorkOffset() || forceSectionRestart;
  var newWorkPlane = isNewWorkPlane() || forceSectionRestart || (typeof defineWorkPlane == "function" &&
    Vector.diff(defineWorkPlane(getPreviousSection(), false), defineWorkPlane(currentSection, false)).length > 1e-4);
  initializeSmoothing(); // initialize smoothing mode
  toolChecked = false; // DWY APW 4.1  clear tool-break-checked flag for this section

  if (insertToolCall || newWorkOffset || newWorkPlane || smoothing.cancel || state.tcpIsActive || currentSection.isMultiAxis()) {
    if (insertToolCall && !isFirstSection()) {
      onCommand(COMMAND_COOLANT_OFF); // turn off coolant before retract during tool change
      onCommand(COMMAND_STOP_SPINDLE); // stop spindle before retract during tool change
    }
    writeRetract(Z); // retract
    cancelLengthCompensation();
    if (isFirstSection()) {
      cancelWorkPlane(machineConfiguration.isMultiAxisConfiguration() && settings.workPlaneMethod.useTiltedWorkplane);
      if (machineConfiguration.isMultiAxisConfiguration()) {
        positionABC(new Vector(0, 0, 0));
      }
      forceABC();
    } else {
      if (insertToolCall || newWorkPlane) {
        cancelWorkPlane();
      }
      if (insertToolCall || smoothing.cancel) {
        setSmoothing(false);
      }
    }
  }

  // DWY >>> APW 4.7a  T# and H# must match
  // APW 8.9.1: milling tools only. Turning tools have no H length offset - the G100 block
  //   uses tool.compensationOffset for them instead - so tool.lengthOffset is meaningless
  //   and the check failed every turning tool.
  //   Tested directly on currentSection and the tool, NOT machineState.isTurningOperation:
  //   this check runs before updateMachiningMode() further down onSection(), so at this
  //   point machineState still describes the PREVIOUS section and would give the wrong
  //   answer on the first turning op after a milling op, and the reverse.
  var apwIsTurningSection = (currentSection.getType() == TYPE_TURNING) || tool.isTurningTool();
  if (!apwIsTurningSection && (tool.number != tool.lengthOffset)) {
    error(
      "Tool mismatch on " + tool.description + ": " +
      "T" + tool.number + " != H" + tool.lengthOffset
    );
  }
  // <<< APW 4.7a

  writeln("");
  writeComment(measureToolsSeparator); // APW 8.8.1  fence each section off from the last

  // APW 8.8.1: operation-comment used to be written here. It now sits with the other
  // operation comments just above the tool call, see below.
  if (getProperty("showNotes")) {
    writeSectionNotes();
  }

  updateMachiningMode(currentSection); // update machining mode

  //set wcs
  var wcsIsRequired = true;
  if (insertToolCall) {
    currentWorkOffset = undefined; // force work offset when changing tool
    wcsIsRequired = newWorkOffset || insertToolCall;
  }
  writeWCS(currentSection, wcsIsRequired);

  var abc = new Vector(0, 0, 0);
  if (machineState.isTurningOperation) {
    abc = defineTurningWorkplane(currentSection);
  } else {
    abc = defineWorkPlane(currentSection, true);
  }

  // DWY >>> APW 8.8.1  tool length check moved AHEAD of the tool call.
  //   It used to sit immediately after the G100 block. The problem is that G100 is itself a
  //   positioning move: it applies the length offset and drives Z to the start height in the
  //   same block. So with a wrong or unset length in the table, the machine had already moved
  //   Z on a bad offset before the check ever ran, which is exactly the crash the check is
  //   supposed to prevent. Checking first means a bad length alarms with the tool still
  //   parked, before anything moves on it.
  //   Gated on insertToolCall so it is written once per tool change, not once per operation.
  //   Counter based labels, see the note on toolChangeCheckCounter.
  if (insertToolCall && getProperty("confirmToolLengths") &&
      isToolLengthCheckable(tool) && !machineState.isTurningOperation) {
    toolChangeCheckCounter += 1;
    writeToolLengthCheck(
      tool,
      toolChangeCheckAlarmBase + toolChangeCheckCounter,
      toolChangeCheckPassBase + toolChangeCheckCounter
    );
    writeln(""); // APW 8.8.2  separate the check from the tool comments below it
  }
  // <<< APW 8.8.1

  // DWY >>> APW 4.7b  job description + tool description + toolpath type, right before the tool call macro (G100)
  if (hasParameter("job-description")) {
    var comment = getParameter("job-description");
    comment += tool.description ? " - " + tool.description : "";
    writeComment(comment);
  }
  writeComment(getParameter("operation-comment", "")); // APW 8.8.1  moved down from the top of the section
  writeComment(getParameter("operation-strategy", "")); // APW 4.9  toolpath type (raw Fusion strategy id, e.g. "adaptive", "contour2d")
  // <<< APW 4.7b

  if (insertToolCall) {
    writeToolCall(tool, insertToolCall);
  }
  // Skip spindle start when G100 macro will be used, as it will stop the spindle and restart again.
  if ((machineState.isTurningOperation || !insertToolCall) && !currentSection.isMultiAxis()) {
    startSpindle(tool, insertToolCall);
  }
  onCommand(COMMAND_START_CHIP_TRANSPORT);

  // write parametric feedrate table
  if (typeof initializeParametricFeeds == "function") {
    initializeParametricFeeds(insertToolCall);
  }

  setProbeAngle(); // output probe angle rotations if required

  if (currentSection.isMultiAxis()) {
    forceAny();
  }

  setSmoothing(smoothing.isAllowed);

  var initialPosition = getFramePosition(currentSection.getInitialPosition());
  if (!insertToolCall) { // G100 tool call macro does handle initial positioning
    var isRequired = state.retractedZ || !state.lengthCompensationActive || (!isFirstSection() && getPreviousSection().isMultiAxis());
    if (currentSection.isMultiAxis()) {
      onCommand(COMMAND_LOAD_TOOL);
      forceAny();
    } else {
      writeInitialPositioning(initialPosition, isRequired);
    }
  }

  var lastCoolant = forceCoolant ? COOLANT_OFF : currentCoolantMode;
  setCoolant(tool.coolant); // writes the required coolant codes

  // add dwell for through coolant if needed
  var dwellCoolants = [COOLANT_THROUGH_TOOL, COOLANT_AIR_THROUGH_TOOL, COOLANT_FLOOD_THROUGH_TOOL];
  if (dwellCoolants.indexOf(currentCoolantMode) != -1 && lastCoolant != currentCoolantMode) {
    onDwell(1);
  }
  if (getProperty("washdownCoolant") == "always") {
    writeBlock(washdownModal.format(tool.type == TOOL_PROBE ? washdownCoolant.off : washdownCoolant.on));
  }

  // output the Machining Load Monitor code
  setMachineLoadMonitor(true, insertToolCall);

  if (isProbeOperation()) {
    validate(probeVariables.probeAngleMethod != "G68", "You cannot probe while G68 Rotation is in effect.");
    validate(probeVariables.probeAngleMethod != "G54.4", "You cannot probe while workpiece setting error compensation G54.4 is enabled.");
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(settings.probing.macroCall, "P" + 8832); // spin the probe on
      inspectionCreateResultsFileHeader();
    }
  }
  if (typeof inspectionProcessSectionStart == "function") {
    inspectionProcessSectionStart();
  }
}

function setMachineLoadMonitor(enable, insertToolCall) {
  if (getProperty("useMachiningLoadMonitor") == "-1") {
    return;
  }
  var loadMonitorCode;
  if (enable && tool.type != TOOL_PROBE) { // enable machine load monitoring
    if (insertToolCall || forceSpindleSpeed || isSpindleSpeedDifferent()) {
      machineLoadMonitorOutput.reset();
    }
    loadMonitorCode = machineLoadMonitorOutput.format(parseInt(getProperty("useMachiningLoadMonitor"), 10));
  } else { // disable machine load monitoring
    loadMonitorCode = machineLoadMonitorOutput.format(340);
  }
  if (loadMonitorCode) {
    writeBlock(loadMonitorCode, formatComment("MACHINING LOAD MONITOR " + (machineLoadMonitorOutput.getCurrent() == 340 ? "OFF" : "ON")));
  }
}

function onDwell(seconds) {
  var maxValue = 99999.999;
  if (seconds > maxValue) {
    warning(subst(localize("Dwelling time of '%1' exceeds the maximum value of '%2' in operation '%3'"), seconds, maxValue, getParameter("operation-comment", "")));
  }
  seconds = clamp(1, seconds, 99999999);
  writeBlock(gFormat.format(4), "P" + secFormat.format(seconds));
}

function onSpindleSpeed(spindleSpeed) {
  writeBlock(sOutput.format(spindleSpeed));
}

function onCycle() {
  writeBlock(gPlaneModal.format(17), gFeedModeModal.format(cycleType == "thread-turning" ? 95 : 94));
}

function getCommonCycle(x, y, z, r) {
  forceXYZ(); // force xyz on first drill hole of any cycle
  if ((currentSection.getPolarMode && currentSection.getPolarMode() != POLAR_MODE_OFF) && currentSection.isMultiAxis()) {
    var polarPosition = getPolarPosition(x, y, z);
    return [xOutput.format(polarPosition.first.x), yOutput.format(polarPosition.first.y), zOutput.format(polarPosition.first.z),
      aOutput.format(polarPosition.second.x), bOutput.format(polarPosition.second.y), cOutput.format(polarPosition.second.z),
      "R" + xyzFormat.format(r)];
  } else {
    return [xOutput.format(x), yOutput.format(y), zOutput.format(z), "R" + xyzFormat.format(r)];
  }
}

/** Convert approach to sign. */
function approach(value) {
  validate((value == "positive") || (value == "negative"), "Invalid approach.");
  return (value == "positive") ? 1 : -1;
}

function protectedProbeMove(_cycle, x, y, z) {
  var _x = xOutput.format(x);
  var _y = yOutput.format(y);
  var _z = zOutput.format(z);
  var _code = getProperty("probingType") == "Renishaw" ? 8810 : 8703;
  if (_z && z >= getCurrentPosition().z) {
    writeBlock(gFormat.format(65), "P" + _code, _z, getFeed(cycle.feedrate)); // protected positioning move
  }
  if (_x || _y) {
    writeBlock(gFormat.format(65), "P" + _code, _x, _y, getFeed(highFeedrate)); // protected positioning move
  }
  if (_z && z < getCurrentPosition().z) {
    writeBlock(gFormat.format(65), "P" + _code, _z, getFeed(cycle.feedrate)); // protected positioning move
  }
}

var threadStart;
var threadEnd;
function moveToThreadStart(x, y, z) {
  var cuttingAngle = getParameter("operation:infeedAngle", 0);
  if (cuttingAngle != 0) {
    var zz;
    if (isFirstCyclePoint()) {
      threadStart = getCurrentPosition();
      threadEnd = new Vector(x, y, z);
    } else {
      var zz = threadStart.z - (Math.abs(threadEnd.x - x) * Math.tan(toRad(cuttingAngle)));
      writeBlock(gMotionModal.format(0), zOutput.format(zz));
      threadStart.setZ(zz);
      threadEnd = new Vector(x, y, z);
    }
  }
}

var lastCycleDepth;
function onCyclePoint(x, y, z) {
  if (isInspectionOperation()) {
    if (typeof inspectionCycleInspect == "function") {
      inspectionCycleInspect(cycle, x, y, z);
      return;
    } else {
      cycleNotSupported();
    }
  } else if (isProbeOperation()) {
    writeProbeCycle(cycle, x, y, z);
  } else {
    writeDrillCycle(cycle, x, y, z);
  }
}

function writeDrillCycle(cycle, x, y, z) {
  switch (cycleType) {
  case "thread-turning":
    var cuttingAngle = getParameter("operation:infeedAngle", 0); // Angle is not stored with tool. toDeg(tool.getTaperAngle());
    var r = -cycle.incrementalX; // positive if taper goes down - delta radius
    if (isFirstCyclePoint()) {
      pitchOutput.reset();
      xOutput.reset();
      zOutput.reset();
    }
    if (tool.turret == 205) {
      writeBlock(gInfeedModal.format(323)); // infeed along Z
    } else if (machineState.isTurningYAxis) {
      writeBlock(gInfeedModal.format(322)); // infeed along Y
    } else if (Math.abs(machineState.isTurningYAxis) % 90 == 0) {
      writeBlock(gInfeedModal.format(321)); // infeed along X
    } else {
      error(localize("The turning angle must be a multiple of 90 degrees for threading cycles."));
    }
    if (getProperty("useSimpleThread") || (getParameter("operation:doMultipleThreads", 0) != 0)) {
      //moveToThreadStart(x, y, z); // not necessary with Q-angle?
      writeBlock(
        gMotionModal.format(392),
        xOutput.format(x),
        yOutput.format(y),
        zOutput.format(z),
        xyzFormat.isSignificant(r) ? g92ROutput.format(r) : "",
        pitchOutput.format(cycle.pitch),
        xyzFormat.isSignificant(cuttingAngle) ? g92QOutput.format(cuttingAngle) : ""
      );
    } else {
      lastCycleDepth = (lastCycleDepth == undefined || x != getCurrentPosition().x) ? getCurrentPosition().x - x :
        lastCycleDepth;
      if (isLastCyclePoint()) {
        // thread height and depth of cut
        var threadHeight = getParameter("operation:threadDepth");
        var useConstantDepth = getParameter("operation:infeedMode") == "constant";
        var firstDepthOfCut = cycle.firstPassDepth ? cycle.firstPassDepth : getParameter("operation:firstPassDepth", threadHeight - Math.abs(getCyclePoint(0).x - x));

        var repeatPass = getParameter("operation:nullPass", 0) + 1;
        var cuttingAngle = getParameter("operation:infeedAngle", 30) * 2; // Angle is not stored with tool. toDeg(tool.getTaperAngle());
        cuttingAngle = cuttingAngle == 0 ? 60 : cuttingAngle;
        gCycleModal.reset();
        writeBlock(
          gCycleModal.format(376),
          xOutput.format(x),
          yOutput.format(y),
          zOutput.format(z),
          xyzFormat.isSignificant(r) ? threadROutput.format(r) : "",
          "P" + xyzFormat.format(threadHeight),
          "Q" + xyzFormat.format(firstDepthOfCut),
          pitchOutput.format(cycle.pitch),
          "D" + integerFormat.format(cuttingAngle),
          "E" + xyzFormat.format(useConstantDepth ? firstDepthOfCut : lastCycleDepth),
          "I" + integerFormat.format(repeatPass),
          "J" + xyzFormat.format(useConstantDepth ? firstDepthOfCut : lastCycleDepth),
          conditional(getParameter("operation:infeedAngle", 0) != 0, "L" + getParameter("operation:infeedAngle")), mFormat.format(323)
        );
      }
    }
    forceFeed();
    return;
  }
  if (!isSameDirection(machineConfiguration.getSpindleAxis(), getForwardDirection(currentSection))) {
    expandCyclePoint(x, y, z);
    return;
  }

  if (isFirstCyclePoint() || isProbeOperation()) {
    if (!isProbeOperation()) {
      // return to initial Z which is clearance plane and set absolute mode
      repositionToCycleClearance(cycle, x, y, z);
    }

    writeBlock(gFeedModeModal.format(94));
    var F = cycle.feedrate;
    var P = !cycle.dwell ? 0 : clamp(1, cycle.dwell, 99999999); // in seconds

    // tapping variables
    var threadPitch = tool.threadPitch;
    var threadsPerInch = 1.0 / threadPitch;

    switch (cycleType) {
    case "drilling":
      writeBlock(
        gRetractModal.format(98), gCycleModal.format(81),
        getCommonCycle(x, y, z, cycle.retract),
        cyclefeedOutput.format(F)
      );
      break;
    case "counter-boring":
      if (P > 0) {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(82),
          getCommonCycle(x, y, z, cycle.retract),
          "P" + secFormat.format(P),
          cyclefeedOutput.format(F)
        );
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(81),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "chip-breaking":
      if ((cycle.accumulatedDepth < cycle.depth) || (P > 0)) {
        expandCyclePoint(x, y, z);
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(73),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          "Q" + xyzFormat.format(cycle.incrementalDepth),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "deep-drilling":
      if (P > 0) {
        expandCyclePoint(x, y, z);
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(83),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          "Q" + xyzFormat.format(cycle.incrementalDepth),
          // conditional(P > 0, "P" + secFormat.format(P)),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "tapping":
      if (!F) {
        F = tool.getTappingFeedrate();
      }
      if (getProperty("usePitchForTapping")) {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format((tool.type == TOOL_TAP_LEFT_HAND) ? 78 : 77),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          unit == IN ? "J" + xyzFormat.format(threadsPerInch) : "",
          unit == MM ? "I" + xyzFormat.format(threadPitch) : "",
          getProperty("doubleTapWithdrawSpeed") ? "L" + (spindleSpeed * 2 > 6000 ? 6000 : spindleSpeed * 2) : ""
        );
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format((tool.type == TOOL_TAP_LEFT_HAND) ? 74 : 84),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          "P" + secFormat.format(P),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "left-tapping":
      if (!F) {
        F = tool.getTappingFeedrate();
      }
      if (getProperty("usePitchForTapping")) {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(78),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          unit == IN ? "J" + xyzFormat.format(threadsPerInch) : "",
          unit == MM ? "I" + xyzFormat.format(threadPitch) : "",
          getProperty("doubleTapWithdrawSpeed") ? "L" + (spindleSpeed * 2 > 6000 ? 6000 : spindleSpeed * 2) : ""
        );
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(74),
          getCommonCycle(x, y, z, cycle.retract),
          "P" + secFormat.format(P),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "right-tapping":
      if (!F) {
        F = tool.getTappingFeedrate();
      }
      if (getProperty("usePitchForTapping")) {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(77),
          getCommonCycle(x, y, cycle.bottom, cycle.retract),
          unit == IN ? "J" + xyzFormat.format(threadsPerInch) : "",
          unit == MM ? "I" + xyzFormat.format(threadPitch) : "",
          getProperty("doubleTapWithdrawSpeed") ? "L" + (spindleSpeed * 2 > 6000 ? 6000 : spindleSpeed * 2) : ""
        );
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(74),
          getCommonCycle(x, y, z, cycle.retract),
          "P" + secFormat.format(P),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "tapping-with-chip-breaking":
    case "left-tapping-with-chip-breaking":
    case "right-tapping-with-chip-breaking":
      if (cycle.accumulatedDepth < cycle.depth) {
        error(localize("Accumulated pecking depth is not supported for tapping cycles with chip breaking."));
      } else {
        if (!F) {
          F = tool.getTappingFeedrate();
        }
        if (getProperty("usePitchForTapping")) {
          writeBlock(
            gRetractModal.format(98), gCycleModal.format((tool.type == TOOL_TAP_LEFT_HAND) ? 78 : 77),
            getCommonCycle(x, y, cycle.bottom, cycle.retract),
            "Q" + xyzFormat.format(cycle.incrementalDepth),
            unit == IN ? "J" + xyzFormat.format(threadsPerInch) : "",
            unit == MM ? "I" + xyzFormat.format(threadPitch) : "",
            getProperty("doubleTapWithdrawSpeed") ? "L" + (spindleSpeed * 2 > 6000 ? 6000 : spindleSpeed * 2) : ""
          );
        } else { // G84/G74 does not support chip breaking
          error(localize("Tapping with chip breaking is not supported by the G74/G84 cycle."));
        }
      }
      break;
    case "fine-boring":
      writeBlock(
        gRetractModal.format(98), gCycleModal.format(76),
        getCommonCycle(x, y, z, cycle.retract),
        "P" + secFormat.format(P), // not optional
        "Q" + xyzFormat.format(cycle.shift),
        feedOutput.format(F)
      );
      break;
    case "back-boring":
      var dx = (gPlaneModal.getCurrent() == 19) ? cycle.backBoreDistance : 0;
      var dy = (gPlaneModal.getCurrent() == 18) ? cycle.backBoreDistance : 0;
      var dz = (gPlaneModal.getCurrent() == 17) ? cycle.backBoreDistance : 0;
      writeBlock(
        gRetractModal.format(98), gCycleModal.format(87),
        getCommonCycle(x, y, z + dz, cycle.bottom),
        "Q" + xyzFormat.format(cycle.shift),
        "P" + secFormat.format(P), // not optional
        cyclefeedOutput.format(F)
      );
      break;
    case "reaming":
      if (feedFormat.getResultingValue(cycle.feedrate) != feedFormat.getResultingValue(cycle.retractFeedrate)) {
        expandCyclePoint(x, y, z);
        break;
      }
      if (P > 0) {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(89),
          getCommonCycle(x, y, z, cycle.retract),
          "P" + secFormat.format(P),
          cyclefeedOutput.format(F)
        );
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(85),
          getCommonCycle(x, y, z, cycle.retract),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "stop-boring":
      if (P > 0) {
        expandCyclePoint(x, y, z);
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(86),
          getCommonCycle(x, y, z, cycle.retract),
          cyclefeedOutput.format(F)
        );
      }
      break;
    case "manual-boring":
      writeBlock(
        gRetractModal.format(98), gCycleModal.format(88),
        getCommonCycle(x, y, z, cycle.retract),
        "P" + secFormat.format(P), // not optional
        cyclefeedOutput.format(F)
      );
      break;
    case "boring":
      if (feedFormat.getResultingValue(cycle.feedrate) != feedFormat.getResultingValue(cycle.retractFeedrate)) {
        expandCyclePoint(x, y, z);
        break;
      }
      if (P > 0) {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(89),
          getCommonCycle(x, y, z, cycle.retract),
          "P" + secFormat.format(P), // not optional
          cyclefeedOutput.format(F)
        );
      } else {
        writeBlock(
          gRetractModal.format(98), gCycleModal.format(85),
          getCommonCycle(x, y, z, cycle.retract),
          cyclefeedOutput.format(F)
        );
      }
      break;
    default:
      expandCyclePoint(x, y, z);
    }
  } else {
    if (cycleExpanded) {
      expandCyclePoint(x, y, z);
    } else {
      if (!xyzFormat.areDifferent(x, xOutput.getCurrent()) && !xyzFormat.areDifferent(y, yOutput.getCurrent())) {
        xOutput.reset(); // at least one axis is required
      }
      if ((currentSection.getPolarMode && currentSection.getPolarMode() != POLAR_MODE_OFF) && currentSection.isMultiAxis()) {
        var polarPosition = getPolarPosition(x, y, z);
        setCurrentPositionAndDirection(polarPosition);
        writeBlock(xOutput.format(polarPosition.first.x), yOutput.format(polarPosition.first.y),
          aOutput.format(polarPosition.second.x), bOutput.format(polarPosition.second.y), cOutput.format(polarPosition.second.z));
      } else {
        writeBlock(xOutput.format(x), yOutput.format(y));
      }
    }
  }
}

function writeProbeCycle(cycle, x, y, z) {
  if (!settings.workPlaneMethod.useTiltedWorkplane && !isSameDirection(currentSection.workPlane.forward, new Vector(0, 0, 1))) {
    if (!settings.probing.allowIndexingWCSProbing && currentSection.strategy == "probe") {
      error(localize("Updating WCS / work offset using probing is only supported by the CNC in the WCS frame."));
    }
  }
  var isMirrored = currentSection.getInternalPatternId && currentSection.getInternalPatternId() != currentSection.getPatternId();
  validate(!isMirrored, "Mirror pattern is not supported for Probing toolpaths.");
  if (currentSection.isPatterned && currentSection.isPatterned()) {
    // probe cycles that cannot be used with patterns
    var unsupportedCycleTypes = ["probing-x", "probing-y", "probing-xy-inner-corner", "probing-xy-outer-corner", "probing-x-plane-angle", "probing-y-plane-angle"];
    if (unsupportedCycleTypes.indexOf(cycleType) > -1 && (!Matrix.diff(new Matrix(), currentSection.workPlane).isZero())) {
      error(subst("Rotary type patterns are not supported for the Probing cycle type '%1'.", cycleType));
    }
  }
  if (printProbeResults()) {
    writeProbingToolpathInformation(z - cycle.depth + tool.diameter / 2);
    inspectionWriteCADTransform();
    inspectionWriteWorkplaneTransform();
    if (typeof inspectionWriteVariables == "function") {
      inspectionVariables.pointNumber += 1;
    }
  }

  // DWY >>> APW 8.3  every probing block is block-skippable so the program can be restarted.
  //   Block skip OFF is the normal production state, so these run on a normal run. Block
  //   skip ON is the restart state, where the part is already located and the operator does
  //   not want to re-probe or re-set the work offset - the same convention the tool break
  //   detection and the tool setting gate (APW 8.0h) already use.
  //
  //   Set here rather than on each G65 line: writeProbeCycle() is the single funnel that
  //   every probing macro call passes through, and there are over forty of them. The flag
  //   is consumed by writeBlock(), so the protected moves inside the switch are covered too.
  //   Cleared in a finally-style block at the end of the switch, and also at the top of
  //   onCycleEnd(), so a cycleNotSupported() or error() path cannot leave it stuck on.
  var apwPrevOptional = optionalSection;
  optionalSection = true;

  protectedProbeMove(cycle, x, y, z);
  switch (cycleType) {
  case "probing-x":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    writeBlock(
      gFormat.format(65), "P" + (getProperty("probingType") == "Renishaw" ? 8811 : 8700),
      conditional(getProperty("probingType") == "Blum", "A1"),
      "X" + xyzFormat.format(x + approach(cycle.approach1) * (cycle.probeClearance + tool.diameter / 2)),
      "Q" + xyzFormat.format(cycle.probeOvertravel),
      getProbingArguments(cycle, true),
      conditional(getProperty("probeShiftX"), "I" + "#190") // APW 4.2 probe shift
    );
    break;
  case "probing-y":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    writeBlock(
      gFormat.format(65), "P" + (getProperty("probingType") == "Renishaw" ? 8811 : 8700),
      conditional(getProperty("probingType") == "Blum", "A1"),
      "Y" + xyzFormat.format(y + approach(cycle.approach1) * (cycle.probeClearance + tool.diameter / 2)),
      "Q" + xyzFormat.format(cycle.probeOvertravel),
      getProbingArguments(cycle, true),
      conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
    );
    break;
  case "probing-z":
    protectedProbeMove(cycle, x, y, Math.min(z - cycle.depth + cycle.probeClearance, cycle.retract));
    writeBlock(
      gFormat.format(65), "P" + (getProperty("probingType") == "Renishaw" ? 8811 : 8700),
      conditional(getProperty("probingType") == "Blum", "A1"),
      "Z" + xyzFormat.format(z - cycle.depth),
      "Q" + xyzFormat.format(cycle.probeOvertravel),
      getProbingArguments(cycle, true),
      conditional(getProperty("probeShiftZ"), "K" + "#192") // APW 4.2 probe shift
    );
    break;
  case "probing-x-wall":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "X" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "X1",
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-y-wall":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Y" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Y1",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-x-channel":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "X" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        // not required "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "X1",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-x-channel-with-island":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "X" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "R" + xyzFormat.format(-cycle.probeClearance),
        "S" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "X1",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-y-channel":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Y" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        // not required "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "Y1",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-y-channel-with-island":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Y" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "R" + xyzFormat.format(-cycle.probeClearance),
        "S" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Y1",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-xy-circular-boss":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8814,
        "D" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190"), // APW 4.2 probe shift
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-xy-circular-partial-boss":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8823,
        "A" + xyzFormat.format(cycle.partialCircleAngleA),
        "B" + xyzFormat.format(cycle.partialCircleAngleB),
        "C" + xyzFormat.format(cycle.partialCircleAngleC),
        "D" + xyzFormat.format(cycle.width1),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      error(localize("XY circular partial boss probing is not supported."));
    }
    break;
  case "probing-xy-circular-hole":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8814,
        "D" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        // not required "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190"), // APW 4.2 probe shift
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-xy-circular-partial-hole":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8823,
        "A" + xyzFormat.format(cycle.partialCircleAngleA),
        "B" + xyzFormat.format(cycle.partialCircleAngleB),
        "C" + xyzFormat.format(cycle.partialCircleAngleC),
        "D" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true)
      );
    } else {
      error(localize("XY circular partial hole probing is not supported."));
    }
    break;
  case "probing-xy-circular-hole-with-island":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8814,
        "Z" + xyzFormat.format(z - cycle.depth),
        "D" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "R" + xyzFormat.format(-cycle.probeClearance),
        "S" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "Z" + xyzFormat.format(z - cycle.depth),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190"), // APW 4.2 probe shift
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-xy-circular-partial-hole-with-island":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8823,
        "Z" + xyzFormat.format(z - cycle.depth),
        "A" + xyzFormat.format(cycle.partialCircleAngleA),
        "B" + xyzFormat.format(cycle.partialCircleAngleB),
        "C" + xyzFormat.format(cycle.partialCircleAngleC),
        "D" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      error(localize("XY circular partial hole with island probing is not supported."));
    }
    break;
  case "probing-xy-rectangular-hole":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "X" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        // not required "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Y" + xyzFormat.format(cycle.width2),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        // not required "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      error(localize("XY rectangular hole probing is not supported."));
    }
    break;
  case "probing-xy-rectangular-boss":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Z" + xyzFormat.format(z - cycle.depth),
        "X" + xyzFormat.format(cycle.width1),
        "R" + xyzFormat.format(cycle.probeClearance),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true)
      );
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Z" + xyzFormat.format(z - cycle.depth),
        "Y" + xyzFormat.format(cycle.width2),
        "R" + xyzFormat.format(cycle.probeClearance),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true)
      );
    } else {
      zOutput.reset();
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width1),
        "X1",
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190"), // APW 4.2 probe shift
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
      zOutput.reset();
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        "S" + xyzFormat.format(cycle.width2),
        "Y1",
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190"), // APW 4.2 probe shift
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-xy-rectangular-hole-with-island":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Z" + xyzFormat.format(z - cycle.depth),
        "X" + xyzFormat.format(cycle.width1),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
      writeBlock(
        gFormat.format(65), "P" + 8812,
        "Z" + xyzFormat.format(z - cycle.depth),
        "Y" + xyzFormat.format(cycle.width2),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(-cycle.probeClearance),
        getProbingArguments(cycle, true)
      );
    } else {
      error(localize("XY rectangular hole with island probing is not supported."));
    }
    break;
  case "probing-xy-inner-corner":
    if (getProperty("probingType") == "Renishaw") {
      var cornerX = x + approach(cycle.approach1) * (cycle.probeClearance + tool.diameter / 2);
      var cornerY = y + approach(cycle.approach2) * (cycle.probeClearance + tool.diameter / 2);
      var cornerI = 0;
      var cornerJ = 0;
      if (cycle.probeSpacing !== undefined) {
        cornerI = cycle.probeSpacing;
        cornerJ = cycle.probeSpacing;
      }
      if ((cornerI != 0) && (cornerJ != 0)) {
        if (currentSection.strategy == "probe") {
          setProbeAngleMethod();
        }
      }
      protectedProbeMove(cycle, x, y, z - cycle.depth);
      writeBlock(
        gFormat.format(65), "P" + 8815, xOutput.format(cornerX), yOutput.format(cornerY),
        cornerI != 0 ? "I" + xyzFormat.format(cornerI) : "",
        cornerJ != 0 ? "J" + xyzFormat.format(cornerJ) : "",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true)
      );
    } else {
      error(localize("XY inner corner probing is not supported."));
    }
    break;
  case "probing-xy-outer-corner":
    var cornerX = x + approach(cycle.approach1) * (cycle.probeClearance + tool.diameter / 2);
    var cornerY = y + approach(cycle.approach2) * (cycle.probeClearance + tool.diameter / 2);
    var cornerI = 0;
    var cornerJ = 0;
    if (cycle.probeSpacing !== undefined) {
      cornerI = cycle.probeSpacing;
      cornerJ = cycle.probeSpacing;
    }
    if ((cornerI != 0) && (cornerJ != 0)) {
      if (currentSection.strategy == "probe") {
        setProbeAngleMethod();
      }
    }
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8816, xOutput.format(cornerX), yOutput.format(cornerY),
        cornerI != 0 ? "I" + xyzFormat.format(cornerI) : "",
        cornerJ != 0 ? "J" + xyzFormat.format(cornerJ) : "",
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true)
      );
    } else {
      writeBlock(
        gFormat.format(65), "P" + 8700,
        "A1",
        xOutput.format(cornerX),
        yOutput.format(cornerY),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, true),
        conditional(getProperty("probeShiftX"), "I" + "#190"), // APW 4.2 probe shift
        conditional(getProperty("probeShiftY"), "J" + "#191") // APW 4.2 probe shift
      );
    }
    break;
  case "probing-x-plane-angle":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8843,
        "X" + xyzFormat.format(x + approach(cycle.approach1) * (cycle.probeClearance + tool.diameter / 2)),
        "D" + xyzFormat.format(cycle.probeSpacing),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "A" + xyzFormat.format(cycle.nominalAngle != undefined ? cycle.nominalAngle : 90),
        getProbingArguments(cycle, false)
      );
      if (currentSection.strategy == "probe") {
        setProbeAngleMethod();
        probeVariables.compensationXY = "X" + xyzFormat.format(0) + " Y" + xyzFormat.format(0);
      }
    } else {
      error(localize("X angle probing is not supported."));
    }
    break;
  case "probing-y-plane-angle":
    protectedProbeMove(cycle, x, y, z - cycle.depth);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8843,
        "Y" + xyzFormat.format(y + approach(cycle.approach1) * (cycle.probeClearance + tool.diameter / 2)),
        "D" + xyzFormat.format(cycle.probeSpacing),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "A" + xyzFormat.format(cycle.nominalAngle != undefined ? cycle.nominalAngle : 0),
        getProbingArguments(cycle, false)
      );
      if (currentSection.strategy == "probe") {
        setProbeAngleMethod();
        probeVariables.compensationXY = "X" + xyzFormat.format(0) + " Y" + xyzFormat.format(0);
      }
    } else {
      error(localize("Y angle probing is not supported."));
    }
    break;
  case "probing-xy-pcd-hole":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8819,
        "A" + xyzFormat.format(cycle.pcdStartingAngle),
        "B" + xyzFormat.format(cycle.numberOfSubfeatures),
        "C" + xyzFormat.format(cycle.widthPCD),
        "D" + xyzFormat.format(cycle.widthFeature),
        "K" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        getProbingArguments(cycle, false)
      );
      if (cycle.updateToolWear) {
        error(localize("Action -Update Tool Wear- is not supported with this cycle."));
      }
    } else {
      error(localize("XY PCD hole probing is not supported."));
    }
    break;
  case "probing-xy-pcd-boss":
    protectedProbeMove(cycle, x, y, z);
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(
        gFormat.format(65), "P" + 8819,
        "A" + xyzFormat.format(cycle.pcdStartingAngle),
        "B" + xyzFormat.format(cycle.numberOfSubfeatures),
        "C" + xyzFormat.format(cycle.widthPCD),
        "D" + xyzFormat.format(cycle.widthFeature),
        "Z" + xyzFormat.format(z - cycle.depth),
        "Q" + xyzFormat.format(cycle.probeOvertravel),
        "R" + xyzFormat.format(cycle.probeClearance),
        getProbingArguments(cycle, false)
      );
      if (cycle.updateToolWear) {
        error(localize("Action -Update Tool Wear- is not supported with this cycle."));
      }
    } else {
      error(localize("XY PCD boss probing is not supported."));
    }
    break;
  default:
    cycleNotSupported();
  }
  optionalSection = apwPrevOptional; // APW 8.3
}
// <<< APW 8.3

function getProbingArguments(cycle, updateWCS) {
  var outputWCSCode = updateWCS && currentSection.strategy == "probe";
  var probeOutputWorkOffset = currentSection.probeWorkOffset;
  if (outputWCSCode) {
    validate(probeOutputWorkOffset <= 99, "Work offset is out of range.");
    var nextWorkOffset = hasNextSection() ? getNextSection().workOffset == 0 ? 1 : getNextSection().workOffset : -1;
    if (probeOutputWorkOffset == nextWorkOffset) {
      currentWorkOffset = undefined;
    }
  }
  if (getProperty("probingType") == "Renishaw") {
    return [
      (cycle.angleAskewAction == "stop-message" ? "B" + xyzFormat.format(cycle.toleranceAngle ? cycle.toleranceAngle : 0) : undefined),
      ((cycle.updateToolWear && cycle.toolWearErrorCorrection < 100) ? "F" + xyzFormat.format(cycle.toolWearErrorCorrection ? cycle.toolWearErrorCorrection / 100 : 100) : undefined),
      (cycle.wrongSizeAction == "stop-message" ? "H" + xyzFormat.format(cycle.toleranceSize ? cycle.toleranceSize : 0) : undefined),
      (cycle.outOfPositionAction == "stop-message" ? "M" + xyzFormat.format(cycle.tolerancePosition ? cycle.tolerancePosition : 0) : undefined),
      ((cycle.updateToolWear && cycleType == "probing-z") ? "T" + xyzFormat.format(cycle.toolLengthOffset) : undefined),
      ((cycle.updateToolWear && cycleType !== "probing-z") ? "T" + xyzFormat.format(cycle.toolDiameterOffset) : undefined),
      (cycle.updateToolWear ? "V" + xyzFormat.format(cycle.toolWearUpdateThreshold ? cycle.toolWearUpdateThreshold : 0) : undefined),
      (cycle.printResults ? "W" + xyzFormat.format(1 + cycle.incrementComponent) : undefined), // 1 for advance feature, 2 for reset feature count and advance component number. first reported result in a program should use W2.
      conditional(outputWCSCode, "S" + probeWCSFormat.format(probeOutputWorkOffset > 6 ? (probeOutputWorkOffset - 6 + 100) : probeOutputWorkOffset))
    ];
  } else {
    // DWY >>> APW 8.0f  Blum tolerance check - only ONE T word is allowed per cycle.
    //
    //   How T works on the Blum system (Applications manual, ch. 8 "Tolerance check"):
    //   There is a single T parameter, and its SIGN selects which thing gets checked:
    //     T POSITIVE -> dimension tolerance. Checks the measured SIZE of the feature
    //                   (surface, corner, inside width, outside width, diameter).
    //     T NEGATIVE -> position tolerance. Checks WHERE the feature is, i.e. the
    //                   deviation of the centre point / edge from the set position
    //                   given by parameters I, J and K.
    //   The magnitude is the tolerance band, and it is always checked ABSOLUTELY, so the
    //   set value must sit in the middle of the tolerance field. If the band is exceeded
    //   the cycle stops with "Tolerance exceeded".
    //
    //   The manual is explicit that only one tolerance field can be checked at a time.
    //   Stock built the array with two separate "T" entries, so enabling both the wrong
    //   size action and the out of position action in CAM emitted two T words in the same
    //   block. A duplicate address is undefined behaviour - the control takes one of them
    //   and the other check silently never happens. Silently unchecked is worse than not
    //   offered, so this errors out and makes the programmer choose.
    if ((cycle.wrongSizeAction == "stop-message") && (cycle.outOfPositionAction == "stop-message")) {
      error(localize(
        "Blum probing allows only one tolerance check per cycle. This operation has both " +
        "a wrong size action and an out of position action set to stop-message. Set one of " +
        "them to none in the CAM operation and post again."
      ));
      return [];
    }
    return [
      // T positive - dimension / size tolerance
      (cycle.wrongSizeAction == "stop-message" ? "T" + xyzFormat.format(cycle.toleranceSize ? cycle.toleranceSize : 0) : undefined),
      // T negative - position tolerance, sign flipped here to tell Blum which check to run
      (cycle.outOfPositionAction == "stop-message" ? "T" + xyzFormat.format(cycle.tolerancePosition ? -1 * cycle.tolerancePosition : 0) : undefined),
      // <<< APW 8.0f
      (cycle.updateToolWear ? "E" + xyzFormat.format(cycle.toolWearNumber) : undefined),
      conditional(outputWCSCode, "W" + probeWCSFormat.format(probeOutputWorkOffset > 6 ? -1 * (probeOutputWorkOffset - 6) : (probeOutputWorkOffset + 53)))
    ];
  }
}

function onCycleEnd() {
  if (isProbeOperation()) {
    zOutput.reset();
    gMotionModal.reset();
    // APW 8.3: the protected retract belongs to the probing block, so it is skipped with it.
    // Leaving it unslashed would fire a protected move with no probing cycle ahead of it.
    var apwPrevOptional = optionalSection;
    optionalSection = true;
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(gFormat.format(65), "P" + 8810, zOutput.format(cycle.retract)); // protected retract move
    } else {
      writeBlock(gFormat.format(65), "P" + 8703, zOutput.format(cycle.retract)); // protected retract move
    }
    optionalSection = apwPrevOptional; // APW 8.3
  } else if (!cycleExpanded) {
    writeBlock(gCycleModal.format(80), gFeedModeModal.format(94));
    zOutput.reset();
    g92ROutput.reset();
    g92QOutput.reset();
  }
}

var resetFeed = false;
function onLinear(_x, _y, _z, feed) {
  if (isSpeedFeedSynchronizationActive() && machineState.isTurningOperation) {
    resetFeed = true;
    var threadPitch = getParameter("operation:threadPitch");
    var threadsPerInch = 1.0 / threadPitch; // per mm for metric
    writeBlock(gMotionModal.format(33), xOutput.format(_x), yOutput.format(_y), zOutput.format(_z), pitchOutput.format(1 / threadsPerInch));
    return;
  }
  if (resetFeed) {
    resetFeed = false;
    forceFeed();
  }
  var x = xOutput.format(_x);
  var y = yOutput.format(_y);
  var z = zOutput.format(_z);
  var f = getFeed(feed);
  if (x || y || z) {
    if (pendingRadiusCompensation >= 0) {
      pendingRadiusCompensation = -1;
      var d = diameterOffsetFormat.format(machineState.isTurningOperation ? tool.compensationOffset : tool.diameterOffset);
      writeBlock(gPlaneModal.format(getPlaneMode()));

      var base = machineState.isTurningOperation ? 100 : 0;
      var ccLeft = (reverseCC) ? base + 42 : base + 41;
      var ccRight = (reverseCC) ? base + 41 : base + 42;
      switch (radiusCompensation) {
      case RADIUS_COMPENSATION_LEFT:
        writeBlock(gFeedModeModal.format(machineState.feedMode), gMotionModal.format(1), gFormat.format(ccLeft), x, y, z, d, f);
        break;
      case RADIUS_COMPENSATION_RIGHT:
        writeBlock(gFeedModeModal.format(machineState.feedMode), gMotionModal.format(1), gFormat.format(ccRight), x, y, z, d, f);
        break;
      default:
        writeBlock(gFeedModeModal.format(machineState.feedMode), gMotionModal.format(1), gFormat.format(40), x, y, z, f);
      }
    } else {
      writeBlock(gFeedModeModal.format(machineState.feedMode), gMotionModal.format(1), x, y, z, f);
    }
  } else if (f) {
    if (getNextRecord().isMotion()) { // try not to output feed without motion
      forceFeed(); // force feed on next line
    } else {
      writeBlock(gFeedModeModal.format(machineState.feedMode), gMotionModal.format(1), f);
    }
  }
}

var mapCommand = {
  COMMAND_STOP_SPINDLE     : 5,
  COMMAND_ORIENTATE_SPINDLE: 19
};

function onCommand(command) {
  switch (command) {
  case COMMAND_COOLANT_OFF:
    setCoolant(COOLANT_OFF);
    return;
  case COMMAND_COOLANT_ON:
    setCoolant(tool.coolant);
    return;
  case COMMAND_STOP:
    writeBlock(mFormat.format(0));
    forceSpindleSpeed = true;
    forceCoolant = true;
    return;
  case COMMAND_OPTIONAL_STOP:
    writeBlock(mFormat.format(1));
    forceSpindleSpeed = true;
    forceCoolant = true;
    return;
  case COMMAND_START_SPINDLE:
    var speed = spindleSpeed;
    var mode = 97;
    var pCode = "";
    if (machineState.isTurningOperation) {
      if (tool.getSpindleMode() == SPINDLE_CONSTANT_SURFACE_SPEED) {
        speed = tool.surfaceSpeed * ((unit == MM) ? 1 / 1000.0 : 1 / 12.0);
        mode = 96;
        var box = currentSection.getBoundingBox();
        var minSpeed = 10;
        var maxSpeed = (tool.maximumSpindleSpeed > 0) ? Math.min(tool.maximumSpindleSpeed, maximumTurningSpeed) : maximumTurningSpeed;
        if (xFormat.getResultingValue(box.upper.x) != 0) {
          minSpeed = Math.min((tool.surfaceSpeed / (Math.PI * Math.abs(box.upper.x * 2))), maximumTurningSpeed);
        }
        gSpindleModeModal.reset();
        pCode = pOutput.format(machineState.speedControlAxis);
        writeBlock(gFormat.format(92), sOutput.format(maxSpeed), qOutput.format(minSpeed));
      } else if (tool.getSpindleMode() == SPINDLE_CONSTANT_SPINDLE_SPEED) {
        speed = Math.min(spindleSpeed, maximumTurningSpeed);
      }
    }
    forceSpindleSpeed = false;
    writeBlock(gSpindleModeModal.format(mode), pCode, sOutput.format(speed), mFormat.format(getSpindleDirection(tool)));
    return;
  case COMMAND_LOAD_TOOL:
    toolChecked = false; // APW 4.1  new tool -> not yet break-checked
    setMachineLoadMonitor(false); // disable machine load monitoring
    // G100 tool call macro does handle retract, initial positioning XYZABC and starts the spindle
    state.retractedZ = true;
    forceModals();
    writeBlock(gAbsIncModal.format(90), gPlaneModal.format(getPlaneMode()), gFeedModeModal.format(machineState.feedMode), (!machineState.isTurningOperation ? gSpindleModeModal.format(97) : "")); // safety block
    var compensationOffset = tool.isTurningTool() ? tool.compensationOffset : tool.lengthOffset;
    var start = getFramePosition(currentSection.getInitialPosition());
    var preloadTool = getNextTool(tool.number != getFirstTool().number);
    var toolBlock = formatWords(gFormat.format(100),
      "T" + toolFormat.format(tool.number),
      xOutput.format(start.x),
      yOutput.format(start.y),
      getLengthCompCode(),
      zOutput.format(start.z),
      (getProperty("preloadTool") && preloadTool) ? "L" + toolFormat.format(preloadTool.number) : undefined,
      hFormat.format(compensationOffset));

    if (tool.type != TOOL_PROBE && !machineState.isTurningOperation) {
      toolBlock += SP + formatWords(diameterOffsetFormat.format(tool.diameterOffset), sOutput.format(spindleSpeed), mFormat.format(getSpindleDirection(tool)));
      forceSpindleSpeed = false;
    }
    writeToolBlock(toolBlock);
    writeComment(tool.comment);
    // APW 8.8.1: the length check used to be written here, after the G100. It now runs in
    // onSection() before the tool call, because G100 moves Z on the length offset.

    // for machine simulation, with TCP enabled G100 acts like prepositionWithTWP
    machineSimulation({a:getCurrentABC().x, b:getCurrentABC().y, c:getCurrentABC().z, coordinates:MACHINE, mode:TCPOFF});
    var W = currentSection.workPlane;
    var prePosition = start;
    var angles = undefined;
    if (tcp.isSupportedByOperation) {
      W = machineConfiguration.isMultiAxisConfiguration() ? machineConfiguration.getOrientation(getCurrentABC()) :
        Matrix.getOrientationFromDirection(getCurrentABC());
      prePosition = W.getTransposed().multiply(start);
      angles = W.getEuler2(settings.workPlaneMethod.eulerConvention);
    }
    machineSimulation({mode:tcp.isSupportedByOperation ? TCPOFF : undefined});
    machineSimulation({x:prePosition.x, y:prePosition.y, mode:tcp.isSupportedByOperation ? TWPON : undefined, eulerAngles:angles});
    machineSimulation(tcp.isSupportedByOperation ? {x:start.x, y:start.y, z:start.z} : {z:start.z});
    currentToolNumber = tool.number;
    return;
  case COMMAND_SPINDLE_CLOCKWISE:
    writeBlock(mFormat.format(machineState.isTurningOperation ? 303 : 3));
    return;
  case COMMAND_SPINDLE_COUNTERCLOCKWISE:
    writeBlock(mFormat.format(machineState.isTurningOperation ? 304 : 4));
    return;
  case COMMAND_STOP_SPINDLE:
    writeBlock(mFormat.format(machineState.isTurningOperation ? 305 : 5));
    return;
  case COMMAND_LOCK_MULTI_AXIS:
    if (machineConfiguration.isMultiAxisConfiguration()) {
      if (aOutput.isEnabled()) {
        writeBlock(fourthAxisClamp.format(443)); // lock A-axis
      }
      if (bOutput.isEnabled()) {
        writeBlock(fifthAxisClamp.format(441)); // lock B-axis
      }
      if (cOutput.isEnabled()) {
        writeBlock(sixthAxisClamp.format(445)); // lock C-axis
      }
    }
    return;
  case COMMAND_UNLOCK_MULTI_AXIS:
    var outputClampCodes = getProperty("useClampCodes") || currentSection.isMultiAxis();
    if (outputClampCodes && machineConfiguration.isMultiAxisConfiguration()) {
      if (aOutput.isEnabled()) {
        writeBlock(fourthAxisClamp.format(442)); // unlock A-axis
      }
      if (bOutput.isEnabled()) {
        writeBlock(fifthAxisClamp.format(440)); // unlock B-axis
      }
      if (cOutput.isEnabled()) {
        writeBlock(sixthAxisClamp.format(444)); // unlock C-axis
      }
    }
    return;
  case COMMAND_START_CHIP_TRANSPORT:
    return;
  case COMMAND_STOP_CHIP_TRANSPORT:
    return;
  case COMMAND_BREAK_CONTROL:
    // DWY >>> APW 4.1  Blum tool break detection (stock leaves this case empty)
    if (!toolChecked) { // avoid duplicate COMMAND_BREAK_CONTROL
      prepareForToolCheck();
      writeBlock(mFormat.format(1));
      writeComment("TOOL BREAK DETECTION");
      writeBlock(mFormat.format(8));
      writeBlock(gFormat.format(69));
      writeBlock(
        "/",
        gFormat.format(65),
        "P" + 8951,
        "H#" + xyzFormat.format(3700),
        "D" + xyzFormat.format(0),
        "B" + xyzFormat.format(2),
        "Q" + xyzFormat.format(0.01),
        "R" + xyzFormat.format(0)
      );
      writeBlock(mFormat.format(9));
      toolChecked = true;
      lengthCompOutput.setCurrent(lengthCompCodes.cancel); // APW: was toolLengthCompOutput.setCurrent(49) -- macro 8951 cancels tool length compensation
      forceWorkPlane();
      forceABC();
    }
    // <<< APW 4.1
    return;
  case COMMAND_TOOL_MEASURE:
    return;
  case COMMAND_ACTIVATE_SPEED_FEED_SYNCHRONIZATION:
    return;
  case COMMAND_DEACTIVATE_SPEED_FEED_SYNCHRONIZATION:
    return;
  case COMMAND_PROBE_ON:
    return;
  case COMMAND_PROBE_OFF:
    return;
  }

  var stringId = getCommandStringId(command);
  var mcode = mapCommand[stringId];
  if (mcode != undefined) {
    writeBlock(mFormat.format(mcode));
  } else {
    onUnsupportedCommand(command);
  }
}

// DWY >>> APW 4.1  tool break detection helper
var toolChecked = false; // specifies that the tool has been checked with the probe
function prepareForToolCheck() {
  onCommand(COMMAND_STOP_SPINDLE);
  onCommand(COMMAND_COOLANT_OFF);

  writeRetract(Z);

  // cancel TCP so the tool does not follow the tables
  // APW: was disableLengthCompensation(false, "TCPC OFF") -- renamed in rev 44229 and the
  // second (comment) argument no longer exists, so the "TCPC OFF" text is not output
  cancelLengthCompensation(false);

  // physically reset to zero workplane if currently indexed
  if (getCurrentDirection().length != 0) {
    setWorkPlane(new Vector(0, 0, 0));
  }

  // force the next section to fully re-output workplane / rotary commands
  forceWorkPlane();
  forceABC();
}
// <<< APW 4.1

// DWY >>> APW 8.0a  optional tool measuring + tool length confirmation
//   Structure ported from the Hi-Fly CNC Speedio post. Both properties default to false.
//   The Blum call itself was rewritten to match shop program O7000.NC and the
//   Blum Z-Nano V3A programming manual (section 4.3, "Measuring the tool length"):
//     - macro is P8951, not P8915 (P8915 does not exist in our manual)
//     - B0. = measure   (B1. = verification, B2. = check, which is what break detect uses)
//     - H = tool correction number. We pass H#3700 (tool currently in the spindle),
//           matching O7000.NC, so the H word can never drift out of sync with the T call.
//     - D is the tool RADIUS correction number, NOT a flute count. The Hi-Fly post used
//           it as a flute count, which would corrupt a tool offset here. D is omitted,
//           matching O7000.NC.
//     - R (radial measuring position) is omitted for now. See measureToolMaxDiameter.
//     - M19 is not needed. Per manual section 3.x, machines with spindle indexing orient
//           automatically to #140 in O8953 and perform a full search across the cutting
//           edges, so "measure all flutes" is handled inside the macro.
//     - tool length and wear offsets are zeroed before measuring, matching O7000.NC.

// DWY >>> APW 8.5  shared tool length check writer
//
//   Emits a two sided band check on the tool table length. Shape:
//
//       (CHECKING LENGTH OF TOOL 31 = GAUGE 5.4525)
//       IF[#11031 LT 5.0525] GOTO 99031
//       IF[#11031 GT 5.8525] GOTO 99031
//       GOTO 99131
//       N99031 #3000=31 (T31 LENGTH OUT OF TOLERANCE)
//       N99131
//
//   Why it is shaped like this:
//     - The control has no IF/THEN. C Control NC Programming manual 6.4.2 documents exactly
//       one form, "IF [conditional equation] GOTO n", with n in the range 1 to 99999. So a
//       conditional alarm needs labels, there is no way around it.
//     - The unconditional "GOTO <pass>" is mandatory. Without it a passing tool falls
//       straight through into the alarm line, because a label is not a barrier. Every tool
//       would alarm, every time.
//     - Two labels per check, both derived so they can never collide. Tool numbers are
//       capped at 99 by APW 8.0b, so the tool setting block uses 99000+tool and 99100+tool,
//       staying inside 99199 and clear of the 99999 skip label. The after tool change checks
//       use a running counter from a different base instead, because the same tool can be
//       called more than once in a program and a repeated label would make GOTO jump to the
//       first match, reporting the wrong tool.
//     - #3000 not #3006. #3006 is stop with message and the operator can simply press cycle
//       start and carry on, which is not acceptable for a wrong tool. #3000 is an alarm and
//       must be reset. Blum use #3000 for every real fault in O8710 and reserve #3006 for
//       advisories like BATTERY_LOW.
//     - Leading blank line. Every block here is a macro statement per NC Programming manual
//       6.7.6 (calculation and control commands), so it is processed during look ahead and
//       not held at a stop. Same behaviour that wiped the tool offsets in APW 8.0i.
function writeToolLengthCheck(tool, alarmLabel, passLabel) {
  // APW 8.7: a label that lands on the tool setting skip label would silently send the GOTO
  // to the wrong place. Only reachable with tool number 999, which APW 8.0b currently blocks,
  // but the ranges are sized for the D control so this stops being theoretical if that limit
  // is ever raised. Fail at post rather than at the machine.
  if ((alarmLabel == measureToolsSkipLabel) || (passLabel == measureToolsSkipLabel)) {
    error(localize("Tool length check label collides with the tool setting skip label for tool: ") + tool.number);
    return;
  }

  var lengthVar = "#" + (11000 + tool.number); // tool length geometry, confirmed by O8717 #16=11000
  var gauge = tool.bodyLength + tool.holderLength;
  var tol = getProperty("toolLengthTolerance");

  // Turn off automatic sequence numbers for the duration of this block. The blocks below
  // write their own N words, and writeBlock() would otherwise prepend a second one, giving
  // "N120 N98001 #3000=..." which is not a valid block. Restored before returning, so the
  // main program numbering is untouched. Needed because this function is also called from
  // onCommand() after a G100, outside the writeMeasureTools() block that already does this.
  var apwPrevShowSeq = getProperty("showSequenceNumbers");
  setProperty("showSequenceNumbers", "false");

  writeln(""); // break look ahead, see note above
  writeComment(localize("CHECKING LENGTH OF TOOL") + " " + tool.number + " = " + localize("GAUGE") + " " + xyzFormat.format(gauge));
  writeBlock("IF[" + lengthVar + " LT " + xyzFormat.format(gauge - tol) + "] GOTO " + alarmLabel);
  writeBlock("IF[" + lengthVar + " GT " + xyzFormat.format(gauge + tol) + "] GOTO " + alarmLabel);
  writeBlock("GOTO " + passLabel);
  writeBlock("N" + alarmLabel, "#3000=" + tool.number + formatComment("T" + tool.number + " " + localize("LENGTH OUT OF TOLERANCE")));
  writeBlock("N" + passLabel);

  setProperty("showSequenceNumbers", apwPrevShowSeq);
}

// Should this tool get a length check at all?
function isToolLengthCheckable(tool) {
  if (tool.number == spindleProbeToolNumber) {
    return false; // spindle probe - never length-check
  }
  if (tool.type == TOOL_PROBE) {
    return false;
  }
  return true;
}
// <<< APW 8.5

// DWY >>> APW 8.0d  shared tool comment builder
//   Single source of truth for the tool list format, used by the program header (APW 4.4c)
//   and by the tool measuring block. Set includeLocation false to drop the vendor field,
//   which the shop uses to hold the crib location - useful in the header, noise at the
//   tool setter.
function buildApwToolComment(tool, includeLocation) {
  var comment = (getProperty("toolAsName") ? "\"" + tool.description.toUpperCase() + "\"" : "T" + toolFormat.format(tool.number)) + " ";
  // APW 8.0e  order is: T## - ID=<prodId> = <description> - OOH=<bodyLength> - HLDR=<holder>
  if (tool.productId) {
    comment += "- ID=" + tool.productId;
    comment += tool.description ? " = " + tool.description : "";
  } else { // no product id -> fall back to leading with the description, no dangling "ID= ="
    comment += tool.description ? "- " + tool.description : "";
  }
  if (tool.bodyLength) {
    comment += " - OOH=" + xyzFormat.format(tool.bodyLength);
  }
  if (tool.holderDescription) { // APW 4.10  no holder -> just omit the HLDR= segment, no extra line
    comment += " - HLDR=" + tool.holderDescription;
  }
  if (includeLocation) {
    comment += tool.vendor ? " -" + tool.vendor : ""; // vendor field is used to hold location
  }
  return comment;
}
// <<< APW 8.0d

// Returns an array of tool numbers that are used by milling sections only.
// Turning tools must never be sent to the tool setter.
function getMillingToolNumbers() {
  var numbers = [];
  for (var i = 0; i < getNumberOfSections(); ++i) {
    var section = getSection(i);
    if (section.getType() == TYPE_TURNING) {
      continue;
    }
    var n = section.getTool().number;
    var found = false;
    for (var j = 0; j < numbers.length; ++j) {
      if (numbers[j] == n) {
        found = true;
        break;
      }
    }
    if (!found) {
      numbers.push(n);
    }
  }
  return numbers;
}

function isMillingToolNumber(numbers, toolNumber) {
  for (var i = 0; i < numbers.length; ++i) {
    if (numbers[i] == toolNumber) {
      return true;
    }
  }
  return false;
}

function writeMeasureTools() {
  if (!getProperty("measureTools") && !getProperty("confirmToolLengths")) {
    return;
  }

  var tools = getToolTable();
  if (tools.getNumberOfTools() == 0) {
    return;
  }
  var millingTools = getMillingToolNumbers();

  // this post does not seed sequenceNumber before the header, so make sure it exists
  if (sequenceNumber == undefined) {
    sequenceNumber = getProperty("sequenceNumberStart");
  }

  // save showSequenceNumbers and disable it - the GOTO logic below writes its own N words
  var show = getProperty("showSequenceNumbers");
  setProperty("showSequenceNumbers", "false");

  // ---- optionally measure tools ----
  //
  // DWY >>> APW 8.0h  block skip gate, replaces the plain "block delete everything" approach.
  //
  //   The machine is set up to run the whole program from the top on a restart, and the
  //   tool break detection is already gated on block skip. So block skip OFF has to remain
  //   the normal production state, and nothing extra may stop the operator on a normal run.
  //
  //   Layout produced below:
  //       /GOTO 99999                     <- runs only when skip is OFF
  //       M00 (TURN OFF BLOCK SKIP ...)   <- no slash, always runs when reached
  //       /  ...tool setting blocks...    <- run only when skip is OFF at this point
  //       N99999
  //
  //   Three cases:
  //     skip OFF the whole time    -> the GOTO fires, jumps straight past everything.
  //                                   Normal production. No extra stop, no tool setting.
  //     skip ON the whole time     -> GOTO is skipped, M00 stops, the slashed tool setting
  //                                   blocks are skipped. This is the restart case: tool
  //                                   break stays skipped and the program continues.
  //     skip ON, operator turns it OFF at the M00 -> GOTO was already skipped, so the
  //                                   tool setting blocks now run. This is how the operator
  //                                   asks for a touch off.
  //
  //   Note the inversion: the GOTO is what keeps the M00 out of the way during production.
  //   Removing it would add a stop to every single run.
  //
  //   The tool list is built BEFORE anything is written, so a program with no measurable
  //   tools emits no gate at all rather than an empty GOTO/M00/N99999 shell.
  if (getProperty("measureTools")) {
    var toMeasure = [];
    for (var i = 0; i < tools.getNumberOfTools(); ++i) {
      var tool = tools.getTool(i);
      if (tool.number == spindleProbeToolNumber) {
        continue; // spindle probe - never measure, regardless of how it is built in CAM
      }
      if ((tool.type == TOOL_PROBE) && !measureProbe) {
        continue;
      }
      if (!isMillingToolNumber(millingTools, tool.number)) {
        continue; // turning tool - never measure
      }
      toMeasure.push(tool);
    }

    if (toMeasure.length > 0) {
      // jump past the whole block on a normal run
      optionalSection = true;
      writeBlock("GOTO " + measureToolsSkipLabel);
      optionalSection = false;

      // reached only when block skip is ON - this is the operator's decision point
      writeBlock(mFormat.format(0), formatComment(localize("TURN OFF BLOCK SKIP TO RUN TOOL SETTING")));
      // APW 8.9: M159 prohibits reading ahead, see C Control NC Programming manual 12.3.6.
      //   The next block is not read until the current operation completes. Unslashed here to
      //   match the M00 above it, which is also unslashed.
      writeBlock(mFormat.format(159));

      optionalSection = true;
      for (var i = 0; i < toMeasure.length; ++i) {
        // APW 8.0d / 8.2: blank line plus a divider so each tool reads as its own block
        writeln("");
        writeComment(measureToolsSeparator);
        writeComment(buildApwToolComment(toMeasure[i], false));
        writeToolMeasureBlock(toMeasure[i], true);
        // APW 8.6: the length check belongs to this tool's touch off, so it goes here rather
        // than in a separate pass at the end. Each tool then reads as one self contained
        // chunk: comment, tool change, confirm stop, touch off, check.
        // Labels derive straight from the tool number because the tool setting block visits
        // each tool exactly once.
        if (getProperty("confirmToolLengths") && isToolLengthCheckable(toMeasure[i])) {
          writeToolLengthCheck(
            toMeasure[i],
            toolSettingCheckAlarmBase + toMeasure[i].number,
            toolSettingCheckPassBase + toMeasure[i].number
          );
        }
      }
      // reload initial tool (side effect cancels tool length compensation)
      writeln("");
      writeComment(measureToolsSeparator); // APW 8.2  close off the last tool
      writeComment(localize("Reload initial tool"));
      writeBlock("T" + toolFormat.format(getSection(0).getTool().number), mFormat.format(6));
      writeBlock(mFormat.format(0), formatComment(localize("READY TO RUN")));
      writeBlock(mFormat.format(159)); // APW 8.9  no reading ahead past this stop either
      optionalSection = false;

      // landing point for the GOTO above
      writeBlock("N" + measureToolsSkipLabel);
      writeln("");
    }
  }
  // <<< APW 8.0h

  // ---- optionally confirm tool lengths (no motion - comment and alarm only) ----
  // APW 8.6: the tool setting block's length checks are now written inline, immediately after
  // each tool's touch off, instead of as a separate pass down here. Note the consequence:
  // with "Optionally measure tools at start" off there is no tool setting block at all, so
  // there are no checks at the top of the program. The unslashed checks after every G100
  // tool change still run, and those are the ones that survive a restart anyway.

  // APW 8.0h: the "READY TO RUN" stop now lives inside the block skip gate above, so that it
  // is only reached when the operator actually asked for a touch off.

  setProperty("showSequenceNumbers", show);
}

function writeToolMeasureBlock(tool, preMeasure) {
  var comment = measureTool ? formatComment("MEASURE TOOL") : "";
  if (!preMeasure) {
    prepareForToolCheck();
  }

  if (getProperty("probingType") == "Renishaw") {
    // Renishaw untested
    writeBlock(
      gFormat.format(65),
      "P9921",
      "M" + 22 + ".",
      "T" + toolFormat.format(tool.number),
      "D" + xyzFormat.format(tool.diameter) + ".",
      comment
    );
  } else { // Blum Z-Nano - mirrors shop program O7000.NC
    // APW 8.8: a tool wider than the probe disc cannot be measured on centre. Skip the touch
    // off for it, but still bring it into the spindle and stop, so the operator has it loaded
    // and can measure it by hand with O7001 right there if they want to.
    var tooWideForProbe = tool.diameter > measureToolMaxDiameter;

    writeBlock("T" + toolFormat.format(tool.number), mFormat.format(6)); // get tool
    // APW 8.0d: stop right after the tool change so the operator must confirm the tool in
    // the spindle matches the comment above before the touch off runs
    writeBlock(mFormat.format(0), formatComment(localize("CONFIRM CORRECT TOOL AND HOLDER AND OOH IS IN SPINDLE")));
    // APW 8.9: M159 prohibits reading ahead (C Control NC Programming manual 12.3.6). This is
    //   the documented fix for the problem APW 8.0i worked around with a blank line: the TLO
    //   clear blocks below are macro statements, so the control was evaluating them during
    //   look ahead while the machine still sat at the M00, wiping the offsets before the
    //   operator had confirmed anything. Blum use M159 the same way all through O8708 and
    //   O8716, around every macro variable read.
    //   Picks up the slash from optionalSection, so it is skipped along with its own M00.
    writeBlock(mFormat.format(159));
    // APW 8.0i: blank line, confirmed on the machine. Kept deliberately.
    //   APW 8.9 added M159 above, which is the documented way to stop the control reading
    //   ahead, so this blank line is now belt and braces rather than the only defence. It
    //   costs nothing and it is what was actually proven on the machine, so it stays.
    //   Macro assignment statements like #[11000+#3700]=0 are evaluated by the control
    //   while it is BUFFERING blocks, not when the block is reached. With the M00 directly
    //   above them, look ahead ran both TLO clears while the machine was still sitting
    //   stopped at the M00, so the offsets were already wiped before the operator had
    //   confirmed anything. A blank line after the M00 breaks the look ahead buffer and
    //   holds the macro statements back until cycle start is pressed.
    writeln("");

    if (tooWideForProbe) {
      // No automatic touch off. Explain it in the program so the operator is not left
      // wondering why this one tool has no measuring block.
      writeComment(localize("NO AUTO TOUCH OFF - CUT DIA") + " " + xyzFormat.format(tool.diameter) +
        " " + localize("IS LARGER THAN THE PROBE DISC") + " " + xyzFormat.format(measureToolMaxDiameter));
      writeComment(localize("THE TOOL CENTRE MAY HAVE NO CUTTING EDGE AND THE EDGES OVERHANG THE DISC"));
      writeComment(localize("MEASURE THIS TOOL BY HAND WITH O7001 THEN CONTINUE"));
    } else {
      // clear the existing length and wear offsets so the measurement does not stack
      writeComment(localize("CLEAR TLO"));
      writeBlock("#[11000+#3700]=0");
      writeBlock("#[10000+#3700]=0");
      writeBlock(
        gFormat.format(65),
        "P8951",
        "B0.",        // B0. = measure tool length
        "H#3700",     // tool correction number of the tool now in the spindle
        comment
      );
    }
  }
  measureTool = false;
}
// <<< APW 8.0a

function onSectionEnd() {
  if (currentSection.isMultiAxis()) {
    writeBlock(gFeedModeModal.format(machineState.feedMode)); // inverse time feed off
  }

  if (isInspectionOperation() && !isLastSection()) {
    writeBlock(getProperty("commissioningMode") ? onCommand(COMMAND_STOP) : "");
  }

  if (tool.type != TOOL_PROBE && getProperty("washdownCoolant") == "operationEnd") {
    writeBlock(washdownModal.format(washdownCoolant.on));
    writeBlock(washdownModal.format(washdownCoolant.off));
  }
  if (!isLastSection()) {
    if (getNextSection().getTool().coolant != tool.coolant) {
      setCoolant(COOLANT_OFF);
    }
    if (tool.breakControl && isToolChangeNeeded(getNextSection(), getProperty("toolAsName") ? "description" : "number")) {
      onCommand(COMMAND_BREAK_CONTROL);
    }
    writeBlock(gPlaneModal.format(getPlaneMode()));
  }
  if (!machineState.isTurningOperation) {
    forceAny();
  }

  if (isProbeOperation()) {
    if (getProperty("probingType") == "Renishaw") {
      writeBlock(settings.probing.macroCall, "P" + 8833); // spin the probe off
      if (probeVariables.probeAngleMethod != "G68") {
        setProbeAngle(); // output probe angle rotations if required
      }
    }
  }
  if (typeof inspectionProcessSectionEnd == "function") {
    inspectionProcessSectionEnd();
  }
  setAllowedCircularPlanes(currentSection.getId());
}

function setAllowedCircularPlanes(sectionId) {
  if ((sectionId + 1) < getNumberOfSections()) {
    var section = getSection(sectionId + 1);
    allowedCircularPlanes = ((section.getType() == TYPE_MILLING) && getSetting("workPlaneMethod.useTiltedWorkplane", false) && defineWorkPlane(section, false).isNonZero()) ?
      1 << PLANE_XY : undefined; // only XY plane is supported for 3+2 in TWP state
  }
}

function writeRetract() {
  var retract = getRetractParameters.apply(this, arguments);
  if (retract && retract.words.length > 0) {
    if (typeof cancelWCSRotation == "function" && getSetting("retract.cancelRotationOnRetracting", false)) { // cancel rotation before retracting
      cancelWCSRotation();
    }
    if (typeof cancelLengthCompensation == "function" && getSetting("allowCancelTCPBeforeRetracting", false) && state.tcpIsActive) {
      cancelLengthCompensation(); // cancel TCP before retracting
    }
    if (retract.retractAxes[2] && state.tcpIsActive) {
      writeBlock(gFormat.format(100), "T" + toolFormat.format(currentToolNumber));
      machineSimulation({mode:RETRACTTOOLAXIS});
      forceSpindleSpeed = true; // force spindle speed for next section if G100 is used since it will stop the spindle.
      return;
    }
    for (var i in retract.words) {
      var words = retract.singleLine ? retract.words : retract.words[i];
      switch (retract.method) {
      case "G28":
        forceModals(gMotionModal, gAbsIncModal);
        writeBlock(gFormat.format(28), gAbsIncModal.format(91), words);
        writeBlock(gAbsIncModal.format(90));
        break;
      case "G53":
        forceModals(gMotionModal);
        writeBlock(gAbsIncModal.format(90), gFormat.format(53), gMotionModal.format(0), words);
        break;
      default:
        if (typeof writeRetractCustom == "function") {
          writeRetractCustom(retract);
          return;
        } else {
          error(subst(localize("Unsupported safe position method '%1'"), retract.method));
        }
      }
      machineSimulation({
        x          : retract.singleLine || words.indexOf("X") != -1 ? retract.positions.x : undefined,
        y          : retract.singleLine || words.indexOf("Y") != -1 ? retract.positions.y : undefined,
        z          : retract.singleLine || words.indexOf("Z") != -1 ? retract.positions.z : undefined,
        coordinates: MACHINE
      });
      if (retract.singleLine) {
        break;
      }
    }
  }
}

function onClose() {
  optionalSection = false;
  if (isDPRNTopen) {
    writeln("DPRNT[END]");
    writeBlock("PCLOS");
    isDPRNTopen = false;
  }
  writeRetract(Z); // retract
  cancelLengthCompensation(true);

  if (probeVariables.probeAngleMethod == "G68") {
    cancelWCSRotation();
  }
  writeln("");

  setCoolant(COOLANT_OFF);
  if (tool.type != TOOL_PROBE) {
    setMachineLoadMonitor(false); // disable machine load monitoring
    if (getProperty("washdownCoolant") == "programEnd") {
      writeBlock(washdownModal.format(washdownCoolant.on));
    }
    writeBlock(washdownModal.format(washdownCoolant.off));
  }

  setTurningMode(false); // reset to milling mode

  var firstTool = getSection(0).getTool();
  writeBlock(gFormat.format(100), "T" + toolFormat.format(firstTool.number));
  if (getSetting("retract.homeXY.onProgramEnd", false)) {
    writeRetract(settings.retract.homeXY.onProgramEnd);
  }
  setSmoothing(false);
  setWorkPlane(new Vector(0, 0, 0)); // reset working plane
  if (typeof inspectionProcessSectionEnd == "function") {
    inspectionProcessSectionEnd();
  }
  writeBlock(mFormat.format(211)); // DWY PArts Counter
  writeBlock(mFormat.format(30)); // stop program, spindle stop, coolant off
}

// >>>>> INCLUDED FROM include_files/commonFunctions.cpi
// internal variables, do not change
var receivedMachineConfiguration;
var tcp = {isSupportedByControl:getSetting("supportsTCP", true), isSupportedByMachine:false, isSupportedByOperation:false};
var state = {
  retractedX              : false, // specifies that the machine has been retracted in X
  retractedY              : false, // specifies that the machine has been retracted in Y
  retractedZ              : false, // specifies that the machine has been retracted in Z
  tcpIsActive             : false, // specifies that TCP is currently active
  twpIsActive             : false, // specifies that TWP is currently active
  lengthCompensationActive: !getSetting("outputToolLengthCompensation", true), // specifies that tool length compensation is active
  mainState               : true // specifies the current context of the state (true = main, false = optional)
};
var validateLengthCompensation = getSetting("outputToolLengthCompensation", true); // disable validation when outputToolLengthCompensation is disabled
var multiAxisFeedrate;
var sequenceNumber;
var optionalSection = false;
var currentWorkOffset;
var forceSpindleSpeed = false;
var operationNeedsSafeStart = false; // used to convert blocks to optional for safeStartAllOperations

function activateMachine() {
  // disable unsupported rotary axes output
  if (!machineConfiguration.isMachineCoordinate(0) && (typeof aOutput != "undefined")) {
    aOutput.disable();
  }
  if (!machineConfiguration.isMachineCoordinate(1) && (typeof bOutput != "undefined")) {
    bOutput.disable();
  }
  if (!machineConfiguration.isMachineCoordinate(2) && (typeof cOutput != "undefined")) {
    cOutput.disable();
  }

  // setup usage of useTiltedWorkplane
  settings.workPlaneMethod.useTiltedWorkplane = getProperty("useTiltedWorkplane") != undefined ? getProperty("useTiltedWorkplane") :
    getSetting("workPlaneMethod.useTiltedWorkplane", false);
  settings.workPlaneMethod.useABCPrepositioning = getSetting("workPlaneMethod.useABCPrepositioning", true);

  if (!machineConfiguration.isMultiAxisConfiguration()) {
    return; // don't need to modify any settings for 3-axis machines
  }

  // identify if any of the rotary axes has TCP enabled
  var axes = [machineConfiguration.getAxisU(), machineConfiguration.getAxisV(), machineConfiguration.getAxisW()];
  tcp.isSupportedByMachine = axes.some(function(axis) {return axis.isEnabled() && axis.isTCPEnabled();}); // true if TCP is enabled on any rotary axis
  if (tcp.isSupportedByMachine) {
    bufferRotaryMoves = false; // disable bufferRotaryMoves if TCP is enabled on any rotary axis
  }

  // save multi-axis feedrate settings from machine configuration
  var mode = machineConfiguration.getMultiAxisFeedrateMode();
  var type = mode == FEED_INVERSE_TIME ? machineConfiguration.getMultiAxisFeedrateInverseTimeUnits() :
    (mode == FEED_DPM ? machineConfiguration.getMultiAxisFeedrateDPMType() : DPM_STANDARD);
  multiAxisFeedrate = {
    mode     : mode,
    maximum  : machineConfiguration.getMultiAxisFeedrateMaximum(),
    type     : type,
    tolerance: mode == FEED_DPM ? machineConfiguration.getMultiAxisFeedrateOutputTolerance() : 0,
    bpwRatio : mode == FEED_DPM ? machineConfiguration.getMultiAxisFeedrateBpwRatio() : 1
  };

  // setup of retract/reconfigure  TAG: Only needed until post kernel supports these machine config settings
  if (receivedMachineConfiguration && machineConfiguration.performRewinds()) {
    safeRetractDistance = machineConfiguration.getSafeRetractDistance();
    safePlungeFeed = machineConfiguration.getSafePlungeFeedrate();
    safeRetractFeed = machineConfiguration.getSafeRetractFeedrate();
  }
  if (typeof safeRetractDistance == "number" && getProperty("safeRetractDistance") != undefined && getProperty("safeRetractDistance") != 0) {
    safeRetractDistance = getProperty("safeRetractDistance");
  }

  if (revision >= 50294) {
    activateAutoPolarMode({tolerance:tolerance / 2, optimizeType:OPTIMIZE_AXIS, expandCycles:getSetting("polarCycleExpandMode", EXPAND_ALL)});
  }

  if (machineConfiguration.isHeadConfiguration() && getSetting("workPlaneMethod.compensateToolLength", false)) {
    for (var i = 0; i < getNumberOfSections(); ++i) {
      var section = getSection(i);
      if (section.isMultiAxis()) {
        machineConfiguration.setToolLength(getBodyLength(section.getTool())); // define the tool length for head adjustments
        section.optimizeMachineAnglesByMachine(machineConfiguration, OPTIMIZE_AXIS);
      }
    }
  } else {
    optimizeMachineAngles2(OPTIMIZE_AXIS);
  }
}

function getBodyLength(tool) {
  for (var i = 0; i < getNumberOfSections(); ++i) {
    var section = getSection(i);
    if (tool.number == section.getTool().number) {
      if (section.hasParameter("operation:tool_assemblyGaugeLength")) { // For Fusion
        return section.getParameter("operation:tool_assemblyGaugeLength", tool.bodyLength + tool.holderLength);
      } else { // Legacy products
        return section.getParameter("operation:tool_overallLength", tool.bodyLength + tool.holderLength);
      }
    }
  }
  return tool.bodyLength + tool.holderLength;
}

function getFeed(f) {
  if (getProperty("useG95")) {
    return feedOutput.format(f / spindleSpeed); // use feed value
  }
  if (typeof activeMovements != "undefined" && activeMovements) {
    var feedContext = activeMovements[movement];
    if (feedContext != undefined) {
      if (!feedFormat.areDifferent(feedContext.feed, f)) {
        if (feedContext.id == currentFeedId) {
          return ""; // nothing has changed
        }
        forceFeed();
        currentFeedId = feedContext.id;
        return settings.parametricFeeds.feedOutputVariable + (settings.parametricFeeds.firstFeedParameter + feedContext.id);
      }
    }
    currentFeedId = undefined; // force parametric feed next time
  }
  return feedOutput.format(f); // use feed value
}

function validateCommonParameters() {
  validateToolData();
  for (var i = 0; i < getNumberOfSections(); ++i) {
    var section = getSection(i);
    if (getSection(0).workOffset == 0 && section.workOffset > 0) {
      if (!(typeof wcsDefinitions != "undefined" && wcsDefinitions.useZeroOffset)) {
        error(localize("Using multiple work offsets is not possible if the initial work offset is 0."));
      }
    }
    if (section.isMultiAxis()) {
      if (!section.isOptimizedForMachine() &&
        (!getSetting("workPlaneMethod.useTiltedWorkplane", false) || !getSetting("supportsToolVectorOutput", false))) {
        error(localize("This postprocessor requires a machine configuration for 5-axis simultaneous toolpath."));
      }
      if (machineConfiguration.getMultiAxisFeedrateMode() == FEED_INVERSE_TIME && !getSetting("supportsInverseTimeFeed", true)) {
        error(localize("This postprocessor does not support inverse time feedrates."));
      }
      if (getSetting("supportsToolVectorOutput", false) && !tcp.isSupportedByControl) {
        error(localize("Incompatible postprocessor settings detected." + EOL +
        "Setting 'supportsToolVectorOutput' requires setting 'supportsTCP' to be enabled as well."));
      }
    }
  }
  if (!tcp.isSupportedByControl && tcp.isSupportedByMachine) {
    error(localize("The machine configuration has TCP enabled which is not supported by this postprocessor."));
  }
  if (getProperty("safePositionMethod") == "clearanceHeight") {
    var msg = "-Attention- Property 'Safe Retracts' is set to 'Clearance Height'." + EOL +
      "Ensure the clearance height will clear the part and or fixtures." + EOL +
      "Raise the Z-axis to a safe height before starting the program.";
    warning(msg);
    writeComment(msg);
  }
}

function validateToolData() {
  var _default = 99999;
  var _maximumSpindleRPM = machineConfiguration.getMaximumSpindleSpeed() > 0 ? machineConfiguration.getMaximumSpindleSpeed() :
    settings.maximumSpindleRPM == undefined ? _default : settings.maximumSpindleRPM;
  var _maximumToolNumber = machineConfiguration.isReceived() && machineConfiguration.getNumberOfTools() > 0 ? machineConfiguration.getNumberOfTools() :
    settings.maximumToolNumber == undefined ? _default : settings.maximumToolNumber;
  var _maximumToolLengthOffset = settings.maximumToolLengthOffset == undefined ? _default : settings.maximumToolLengthOffset;
  var _maximumToolDiameterOffset = settings.maximumToolDiameterOffset == undefined ? _default : settings.maximumToolDiameterOffset;

  var header = ["Detected maximum values are out of range.", "Maximum values:"];
  var warnings = {
    toolNumber    : {msg:"Tool number value exceeds the maximum value for tool: " + EOL, max:" Tool number: " + _maximumToolNumber, values:[]},
    lengthOffset  : {msg:"Tool length offset value exceeds the maximum value for tool: " + EOL, max:" Tool length offset: " + _maximumToolLengthOffset, values:[]},
    diameterOffset: {msg:"Tool diameter offset value exceeds the maximum value for tool: " + EOL, max:" Tool diameter offset: " + _maximumToolDiameterOffset, values:[]},
    spindleSpeed  : {msg:"Spindle speed exceeds the maximum value for operation: " + EOL, max:" Spindle speed: " + _maximumSpindleRPM, values:[]}
  };

  var toolIds = [];
  for (var i = 0; i < getNumberOfSections(); ++i) {
    var section = getSection(i);
    if (toolIds.indexOf(section.getTool().getToolId()) === -1) { // loops only through sections which have a different tool ID
      var toolNumber = section.getTool().number;
      var lengthOffset = section.getTool().lengthOffset;
      var diameterOffset = section.getTool().diameterOffset;
      var comment = section.getParameter("operation-comment", "");

      if (toolNumber > _maximumToolNumber && !getProperty("toolAsName")) {
        warnings.toolNumber.values.push(SP + toolNumber + EOL);
      }
      if (lengthOffset > _maximumToolLengthOffset) {
        warnings.lengthOffset.values.push(SP + "Tool " + toolNumber + " (" + comment + "," + " Length offset: " + lengthOffset + ")" + EOL);
      }
      if (diameterOffset > _maximumToolDiameterOffset) {
        warnings.diameterOffset.values.push(SP + "Tool " + toolNumber + " (" + comment + "," + " Diameter offset: " + diameterOffset + ")" + EOL);
      }
      toolIds.push(section.getTool().getToolId());
    }
    // loop through all sections regardless of tool id for idenitfying spindle speeds

    // identify if movement ramp is used in current toolpath, use ramp spindle speed for comparisons
    var ramp = section.getMovements() & ((1 << MOVEMENT_RAMP) | (1 << MOVEMENT_RAMP_ZIG_ZAG) | (1 << MOVEMENT_RAMP_PROFILE) | (1 << MOVEMENT_RAMP_HELIX));
    var _sectionSpindleSpeed = Math.max(section.getTool().spindleRPM, ramp ? section.getTool().rampingSpindleRPM : 0, 0);
    if (_sectionSpindleSpeed > _maximumSpindleRPM) {
      warnings.spindleSpeed.values.push(SP + section.getParameter("operation-comment", "") + " (" + _sectionSpindleSpeed + " RPM" + ")" + EOL);
    }
  }

  // sort lists by tool number
  warnings.toolNumber.values.sort(function(a, b) {return a - b;});
  warnings.lengthOffset.values.sort(function(a, b) {return a.localeCompare(b);});
  warnings.diameterOffset.values.sort(function(a, b) {return a.localeCompare(b);});

  // DWY >>> APW 8.0c  hard-fail on out-of-range tool numbers and offsets.
  //   The stock code below only calls warning(), which prints a message and still posts
  //   NC code. A tool number or offset above 99 addresses the wrong Brother system
  //   variable (T100 -> #11100) with no alarm at the control, so this must stop the post.
  //   Spindle speed deliberately keeps its stock warning-only behaviour.
  var apwFatal = [];
  if (warnings.toolNumber.values.length != 0) {
    apwFatal.push(warnings.toolNumber.msg + warnings.toolNumber.values.join(""));
  }
  if (warnings.lengthOffset.values.length != 0) {
    apwFatal.push(warnings.lengthOffset.msg + warnings.lengthOffset.values.join(""));
  }
  if (warnings.diameterOffset.values.length != 0) {
    apwFatal.push(warnings.diameterOffset.msg + warnings.diameterOffset.values.join(""));
  }
  if (apwFatal.length != 0) {
    apwFatal.unshift(localize("Tool numbers and offsets must be in the range 1-99 on this control.") + EOL);
    error(apwFatal.join(EOL));
    return;
  }
  // <<< APW 8.0c

  var warningMessages = [];
  for (var key in warnings) {
    if (warnings[key].values != "") {
      header.push(warnings[key].max); // add affected max values to the header
      warningMessages.push(warnings[key].msg + warnings[key].values.join(""));
    }
  }
  if (warningMessages.length != 0) {
    warningMessages.unshift(header.join(EOL) + EOL);
    warning(warningMessages.join(EOL));
  }
}

function forceFeed() {
  currentFeedId = undefined;
  feedOutput.reset();
}

/** Force output of X, Y, and Z. */
function forceXYZ() {
  xOutput.reset();
  yOutput.reset();
  zOutput.reset();
}

/** Force output of A, B, and C. */
function forceABC() {
  aOutput.reset();
  bOutput.reset();
  cOutput.reset();
}

/** Force output of X, Y, Z, A, B, C, and F on next output. */
function forceAny() {
  forceXYZ();
  forceABC();
  forceFeed();
}

/**
  Writes the specified block.
*/
function writeBlock() {
  var text = formatWords(arguments);
  if (!text) {
    return;
  }
  var prefix = getSetting("sequenceNumberPrefix", "N");
  var suffix = getSetting("writeBlockSuffix", "");
  if ((optionalSection || skipBlocks) && !getSetting("supportsOptionalBlocks", true)) {
    error(localize("Optional blocks are not supported by this post."));
  }
  if (getProperty("showSequenceNumbers") == "true") {
    if (sequenceNumber == undefined || sequenceNumber >= settings.maximumSequenceNumber) {
      sequenceNumber = getProperty("sequenceNumberStart");
    }
    if (optionalSection || skipBlocks) {
      writeWords2("/", prefix + sequenceNumber, text + suffix);
    } else {
      writeWords2(prefix + sequenceNumber, text + suffix);
    }
    sequenceNumber += getProperty("sequenceNumberIncrement");
  } else {
    if (optionalSection || skipBlocks) {
      writeWords2("/", text + suffix);
    } else {
      writeWords(text + suffix);
    }
  }
}

validate(settings.comments, "Setting 'comments' is required but not defined.");
function formatComment(text) {
  var prefix = settings.comments.prefix;
  var suffix = settings.comments.suffix;
  var _permittedCommentChars = settings.comments.permittedCommentChars == undefined ? "" : settings.comments.permittedCommentChars;
  switch (settings.comments.outputFormat) {
  case "upperCase":
    text = text.toUpperCase();
    _permittedCommentChars = _permittedCommentChars.toUpperCase();
    break;
  case "lowerCase":
    text = text.toLowerCase();
    _permittedCommentChars = _permittedCommentChars.toLowerCase();
    break;
  case "ignoreCase":
    _permittedCommentChars = _permittedCommentChars.toUpperCase() + _permittedCommentChars.toLowerCase();
    break;
  default:
    error(localize("Unsupported option specified for setting 'comments.outputFormat'."));
  }
  if (_permittedCommentChars != "") {
    text = filterText(String(text), _permittedCommentChars);
  }
  text = String(text).substring(0, settings.comments.maximumLineLength - prefix.length - suffix.length);
  return text != "" ? prefix + text + suffix : "";
}

/**
  Output a comment.
*/
function writeComment(text) {
  if (!text) {
    return;
  }
  var comments = String(text).split(/\r?\n/);
  for (comment in comments) {
    var _comment = formatComment(comments[comment]);
    if (_comment) {
      if (getSetting("comments.showSequenceNumbers", false)) {
        writeBlock(_comment);
      } else {
        writeln(_comment);
      }
    }
  }
}

function onComment(text) {
  writeComment(text);
}

/**
  Writes the specified block - used for tool changes only.
*/
function writeToolBlock() {
  var show = getProperty("showSequenceNumbers");
  setProperty("showSequenceNumbers", (show == "true" || show == "toolChange") ? "true" : "false");
  writeBlock(arguments);
  setProperty("showSequenceNumbers", show);
  machineSimulation({/*x:toPreciseUnit(200, MM), y:toPreciseUnit(200, MM), coordinates:MACHINE,*/ mode:TOOLCHANGE}); // move machineSimulation to a tool change position
}

var skipBlocks = false;
var initialState = JSON.parse(JSON.stringify(state)); // save initial state
var optionalState = JSON.parse(JSON.stringify(state));
var saveCurrentSectionId = undefined;
function writeStartBlocks(isRequired, code) {
  var saveSkipBlocks = skipBlocks;
  var saveMainState = state; // save main state

  if (!isRequired) {
    if (!getProperty("safeStartAllOperations", false)) {
      return; // when safeStartAllOperations is disabled, dont output code and return
    }
    if (saveCurrentSectionId != getCurrentSectionId()) {
      saveCurrentSectionId = getCurrentSectionId();
      forceModals(); // force all modal variables when entering a new section
      optionalState = Object.create(initialState); // reset optionalState to initialState when entering a new section
    }
    skipBlocks = true; // if values are not required, but safeStartAllOperations is enabled - write following blocks as optional
    state = optionalState; // set state to optionalState if skipBlocks is true
    state.mainState = false;
  }
  code(); // writes out the code which is passed to this function as an argument

  state = saveMainState; // restore main state
  skipBlocks = saveSkipBlocks; // restore skipBlocks value
}

var pendingRadiusCompensation = -1;
function onRadiusCompensation() {
  pendingRadiusCompensation = radiusCompensation;
  if (pendingRadiusCompensation >= 0 && !getSetting("supportsRadiusCompensation", true)) {
    error(localize("Radius compensation mode is not supported."));
    return;
  }
}

function onPassThrough(text) {
  var commands = String(text).split(",");
  for (text in commands) {
    writeBlock(commands[text]);
  }
}

function forceModals() {
  if (arguments.length == 0) { // reset all modal variables listed below
    var modals = [
      "gMotionModal",
      "gPlaneModal",
      "gAbsIncModal",
      "gFeedModeModal",
      "feedOutput"
    ];
    if (operationNeedsSafeStart && (typeof currentSection != "undefined" && currentSection.isMultiAxis())) {
      modals.push("fourthAxisClamp", "fifthAxisClamp", "sixthAxisClamp");
    }
    for (var i = 0; i < modals.length; ++i) {
      if (typeof this[modals[i]] != "undefined") {
        this[modals[i]].reset();
      }
    }
  } else {
    for (var i in arguments) {
      arguments[i].reset(); // only reset the modal variable passed to this function
    }
  }
}

/** Helper function to be able to use a default value for settings which do not exist. */
function getSetting(setting, defaultValue) {
  var result = defaultValue;
  var keys = setting.split(".");
  var obj = settings;
  for (var i in keys) {
    if (obj[keys[i]] != undefined) { // setting does exist
      result = obj[keys[i]];
      if (typeof [keys[i]] === "object") {
        obj = obj[keys[i]];
        continue;
      }
    } else { // setting does not exist, use default value
      if (defaultValue != undefined) {
        result = defaultValue;
      } else {
        error("Setting '" + keys[i] + "' has no default value and/or does not exist.");
        return undefined;
      }
    }
  }
  return result;
}

function getForwardDirection(_section) {
  var forward = undefined;
  var _optimizeType = settings.workPlaneMethod && settings.workPlaneMethod.optimizeType;
  if (_section.isMultiAxis()) {
    forward = _section.workPlane.forward;
  } else if (!getSetting("workPlaneMethod.useTiltedWorkplane", false) && machineConfiguration.isMultiAxisConfiguration()) {
    if (_optimizeType == undefined) {
      var saveRotation = getRotation();
      getWorkPlaneMachineABC(_section, true);
      forward = getRotation().forward;
      setRotation(saveRotation); // reset rotation
    } else {
      var abc = getWorkPlaneMachineABC(_section, false);
      var forceAdjustment = settings.workPlaneMethod.optimizeType == OPTIMIZE_TABLES || settings.workPlaneMethod.optimizeType == OPTIMIZE_BOTH;
      forward = machineConfiguration.getOptimizedDirection(_section.workPlane.forward, abc, false, forceAdjustment);
    }
  } else {
    forward = getRotation().forward;
  }
  return forward;
}

function getRetractParameters() {
  var _arguments = typeof arguments[0] === "object" ? arguments[0].axes : arguments;
  var singleLine = arguments[0].singleLine == undefined ? true : arguments[0].singleLine;
  var words = []; // store all retracted axes in an array
  var retractAxes = new Array(false, false, false);
  var method = getProperty("safePositionMethod", "undefined");
  if (method == "clearanceHeight") {
    if (!is3D()) {
      error(localize("Safe retract option 'Clearance Height' is only supported when all operations are along the setup Z-axis."));
    }
    return undefined;
  }
  validate(settings.retract, "Setting 'retract' is required but not defined.");
  validate(_arguments.length != 0, "No axis specified for getRetractParameters().");
  for (i in _arguments) {
    retractAxes[_arguments[i]] = true;
  }
  if ((retractAxes[0] || retractAxes[1]) && !state.retractedZ) { // retract Z first before moving to X/Y home
    error(localize("Retracting in X/Y is not possible without being retracted in Z."));
    return undefined;
  }
  // special conditions
  if (retractAxes[0] || retractAxes[1]) {
    method = getSetting("retract.methodXY", method);
  }
  if (retractAxes[2]) {
    method = getSetting("retract.methodZ", method);
  }
  // define home positions
  var useZeroValues = (settings.retract.useZeroValues && settings.retract.useZeroValues.indexOf(method) != -1);
  var _xHome = machineConfiguration.hasHomePositionX() && !useZeroValues ? machineConfiguration.getHomePositionX() : toPreciseUnit(0, MM);
  var _yHome = machineConfiguration.hasHomePositionY() && !useZeroValues ? machineConfiguration.getHomePositionY() : toPreciseUnit(0, MM);
  var _zHome = machineConfiguration.getRetractPlane() != 0 && !useZeroValues ? machineConfiguration.getRetractPlane() : toPreciseUnit(0, MM);
  for (var i = 0; i < _arguments.length; ++i) {
    switch (_arguments[i]) {
    case X:
      if (!state.retractedX) {
        words.push("X" + xyzFormat.format(_xHome));
        xOutput.reset();
        state.retractedX = true;
      }
      break;
    case Y:
      if (!state.retractedY) {
        words.push("Y" + xyzFormat.format(_yHome));
        yOutput.reset();
        state.retractedY = true;
      }
      break;
    case Z:
      if (!state.retractedZ) {
        words.push("Z" + xyzFormat.format(_zHome));
        zOutput.reset();
        state.retractedZ = true;
      }
      break;
    default:
      error(localize("Unsupported axis specified for getRetractParameters()."));
      return undefined;
    }
  }
  return {
    method     : method,
    retractAxes: retractAxes,
    words      : words,
    positions  : {
      x: retractAxes[0] ? _xHome : undefined,
      y: retractAxes[1] ? _yHome : undefined,
      z: retractAxes[2] ? _zHome : undefined},
    singleLine: singleLine};
}

/** Returns true when subprogram logic does exist into the post. */
function subprogramsAreSupported() {
  return typeof subprogramState != "undefined";
}

// Start of machine simulation connection move support
var debugSimulation = false; // enable to output debug information for connection move support in the NC program
var TCPON = "TCP ON";
var TCPOFF = "TCP OFF";
var TWPON = "TWP ON";
var TWPOFF = "TWP OFF";
var TOOLCHANGE = "TOOL CHANGE";
var RETRACTTOOLAXIS = "RETRACT TOOLAXIS";
var WORK = "WORK CS";
var MACHINE = "MACHINE CS";
var MIN = "MIN";
var MAX = "MAX";
var SHORTEST = "SHORTEST";
var PROGRAMMED = "PROGRAMMED";
var WARNING_NON_RANGE = [0, 1, 2];
var isTwpOn;
var isTcpOn;
/**
 * Helper function for connection moves in machine simulation.
 * @param {Object} parameters An object containing the desired options for machine simulation.
 * @note Available properties are:
 * @param {Number} x X axis position, alternatively use MIN or MAX to move to the axis limit
 * @param {Number} y Y axis position, alternatively use MIN or MAX to move to the axis limit
 * @param {Number} z Z axis position, alternatively use MIN or MAX to move to the axis limit
 * @param {Number} a A axis position (in radians)
 * @param {Number} b B axis position (in radians)
 * @param {Number} c C axis position (in radians)
 * @param {Number} feed desired feedrate, automatically set to high/current feedrate if not specified
 * @param {String} mode mode TCPON | TCPOFF | TWPON | TWPOFF | TOOLCHANGE | RETRACTTOOLAXIS
 * @param {String} coordinates WORK | MACHINE - if undefined, work coordinates will be used by default
 * @param {Number} eulerAngles the calculated Euler angles for the workplane
 * @param {String} rotaryMode SHORTEST | PROGRAMMED - if undefined, the default rotary mode will be used
 * @example
  machineSimulation({a:abc.x, b:abc.y, c:abc.z, coordinates:MACHINE});
  machineSimulation({x:toPreciseUnit(200, MM), y:toPreciseUnit(200, MM), coordinates:MACHINE, mode:TOOLCHANGE});
  machineSimulation({a:abc.x, b:abc.y, c:abc.z, coordinates:MACHINE, rotaryMode:SHORTEST});
*/
function machineSimulation(parameters) {
  if (revision < 50198 || skipBlocks || (getSimulationStreamPath() == "" && !debugSimulation)) {
    return; // return when post kernel revision is lower than 50198 or when skipBlocks is enabled
  }
  getAxisLimit = function(axis, limit) {
    validate(limit == MIN || limit == MAX, subst(localize("Invalid argument \"%1\" passed to the machineSimulation function."), limit));
    var range = axis.getRange();
    if (range.isNonRange()) {
      var axisLetters = ["X", "Y", "Z"];
      var warningMessage = subst(localize("An attempt was made to move the \"%1\" axis to its MIN/MAX limits during machine simulation, but its range is set to \"unlimited\"." + EOL +
        "A limited range must be set for the \"%1\" axis in the machine definition, or these motions will not be shown in machine simulation."), axisLetters[axis.getCoordinate()]);
      warningOnce(warningMessage, WARNING_NON_RANGE[axis.getCoordinate()]);
      return undefined;
    }
    return limit == MIN ? range.minimum : range.maximum;
  };
  var x = (isNaN(parameters.x) && parameters.x) ? getAxisLimit(machineConfiguration.getAxisX(), parameters.x) : parameters.x;
  var y = (isNaN(parameters.y) && parameters.y) ? getAxisLimit(machineConfiguration.getAxisY(), parameters.y) : parameters.y;
  var z = (isNaN(parameters.z) && parameters.z) ? getAxisLimit(machineConfiguration.getAxisZ(), parameters.z) : parameters.z;
  var rotaryAxesErrorMessage = localize("Invalid argument for rotary axes passed to the machineSimulation function. Only numerical values are supported.");
  var a = (isNaN(parameters.a) && parameters.a) ? error(rotaryAxesErrorMessage) : parameters.a;
  var b = (isNaN(parameters.b) && parameters.b) ? error(rotaryAxesErrorMessage) : parameters.b;
  var c = (isNaN(parameters.c) && parameters.c) ? error(rotaryAxesErrorMessage) : parameters.c;
  var coordinates = parameters.coordinates;
  var eulerAngles = parameters.eulerAngles;
  var rotaryMode = parameters.rotaryMode;
  var feed = parameters.feed;
  if (feed === undefined && typeof gMotionModal !== "undefined") {
    feed = gMotionModal.getCurrent() !== 0;
  }
  var mode = parameters.mode;
  var performToolChange = mode == TOOLCHANGE;
  if (mode !== undefined && ![TCPON, TCPOFF, TWPON, TWPOFF, TOOLCHANGE, RETRACTTOOLAXIS].includes(mode)) {
    error(subst("Mode '%1' is not supported.", mode));
  }
  if (rotaryMode !== undefined && ![SHORTEST, PROGRAMMED].includes(rotaryMode)) {
    error(subst(localize("Rotary mode '%1' is not supported."), rotaryMode));
  }

  // mode takes precedence over TCP/TWP states
  var enableTCP = isTcpOn;
  var enableTWP = isTwpOn;
  if (mode === TCPON || mode === TCPOFF) {
    enableTCP = mode === TCPON;
  } else if (mode === TWPON || mode === TWPOFF) {
    enableTWP = mode === TWPON;
  } else {
    enableTCP = typeof state !== "undefined" && state.tcpIsActive;
    enableTWP = typeof state !== "undefined" && state.twpIsActive;
  }
  var disableTCP = !enableTCP;
  var disableTWP = !enableTWP;
  if (disableTWP) {
    simulation.setTWPModeOff();
    isTwpOn = false;
  }
  if (disableTCP) {
    simulation.setTCPModeOff();
    isTcpOn = false;
  }
  if (enableTCP) {
    simulation.setTCPModeOn();
    isTcpOn = true;
  }
  if (enableTWP) {
    if (settings.workPlaneMethod.eulerConvention == undefined) {
      simulation.setTWPModeAlignToCurrentPose();
    } else if (eulerAngles) {
      simulation.setTWPModeByEulerAngles(settings.workPlaneMethod.eulerConvention, eulerAngles.x, eulerAngles.y, eulerAngles.z);
    }
    isTwpOn = true;
  }
  if (mode == RETRACTTOOLAXIS) {
    simulation.retractAlongToolAxisToLimit();
  }

  if (debugSimulation) {
    writeln("  DEBUG" + JSON.stringify(parameters));
    writeln("  DEBUG" + JSON.stringify({isTwpOn:isTwpOn, isTcpOn:isTcpOn, feed:feed}));
  }

  if (x !== undefined || y !== undefined || z !== undefined || a !== undefined || b !== undefined || c !== undefined) {
    if (x !== undefined) {simulation.setTargetX(x);}
    if (y !== undefined) {simulation.setTargetY(y);}
    if (z !== undefined) {simulation.setTargetZ(z);}
    if (a !== undefined) {simulation.setTargetA(a);}
    if (b !== undefined) {simulation.setTargetB(b);}
    if (c !== undefined) {simulation.setTargetC(c);}

    if (feed != undefined && feed) {
      simulation.setMotionToLinear();
      simulation.setFeedrate(typeof feed == "number" ? feed : feedOutput.getCurrent() == 0 ? highFeedrate : feedOutput.getCurrent());
    } else {
      simulation.setMotionToRapid();
    }

    var supportsRotaryMode = rotaryMode !== undefined && revision >= 50338;
    var saveRotaryDirection = supportsRotaryMode ? simulation.getRotaryDirection() : undefined;
    if (supportsRotaryMode) {
      if (rotaryMode === SHORTEST) {
        simulation.setRotaryToGoShortestDirection();
      } else if (rotaryMode === PROGRAMMED) {
        simulation.setRotaryToGoProgrammedDirection();
      }
    }

    if (coordinates != undefined && coordinates == MACHINE) {
      simulation.moveToTargetInMachineCoords();
    } else {
      simulation.moveToTargetInWorkCoords();
    }

    if (supportsRotaryMode) {
      if (saveRotaryDirection === ROTARY_DIRECTION_AS_PROGRAMMED) {
        simulation.setRotaryToGoProgrammedDirection();
      } else {
        simulation.setRotaryToGoShortestDirection();
      }
    }
  }
  if (performToolChange) {
    simulation.performToolChangeCycle();
    simulation.moveToTargetInMachineCoords();
  }
}
// <<<<< INCLUDED FROM include_files/commonFunctions.cpi
// >>>>> INCLUDED FROM include_files/defineWorkPlane.cpi
validate(settings.workPlaneMethod, "Setting 'workPlaneMethod' is required but not defined.");
function defineWorkPlane(_section, _setWorkPlane) {
  var abc = new Vector(0, 0, 0);
  if (settings.workPlaneMethod.forceMultiAxisIndexing || !is3D() || machineConfiguration.isMultiAxisConfiguration()) {
    if (isPolarModeActive()) {
      abc = getCurrentDirection();
    } else if (_section.isMultiAxis()) {
      forceWorkPlane();
      cancelTransformation();
      abc = _section.isOptimizedForMachine() ? _section.getInitialToolAxisABC() : _section.getGlobalInitialToolAxis();
    } else if (settings.workPlaneMethod.useTiltedWorkplane && settings.workPlaneMethod.eulerConvention != undefined) {
      if (settings.workPlaneMethod.eulerCalculationMethod == "machine" && machineConfiguration.isMultiAxisConfiguration()) {
        abc = machineConfiguration.getOrientation(getWorkPlaneMachineABC(_section, true)).getEuler2(settings.workPlaneMethod.eulerConvention);
      } else {
        abc = _section.workPlane.getEuler2(settings.workPlaneMethod.eulerConvention);
      }
    } else {
      abc = getWorkPlaneMachineABC(_section, true);
    }

    if (_setWorkPlane) {
      if (_section.isMultiAxis() || isPolarModeActive()) { // 4-5x simultaneous operations
        cancelWorkPlane();
        if (_section.isOptimizedForMachine()) {
          positionABC(abc, true);
        } else {
          setCurrentDirection(abc);
        }
      } else { // 3x and/or 3+2x operations
        setWorkPlane(abc);
      }
    }
  } else {
    var remaining = _section.workPlane;
    if (!isSameDirection(remaining.forward, new Vector(0, 0, 1))) {
      error(localize("Tool orientation is not supported."));
      return abc;
    }
    setRotation(remaining);
  }
  tcp.isSupportedByOperation = isTCPSupportedByOperation(_section);
  return abc;
}

function isTCPSupportedByOperation(_section) {
  var _tcp = _section.getOptimizedTCPMode() == OPTIMIZE_NONE;
  if (!_section.isMultiAxis() && (settings.workPlaneMethod.useTiltedWorkplane ||
    (machineConfiguration.isMultiAxisConfiguration() && settings.workPlaneMethod.optimizeType != undefined ?
      getWorkPlaneMachineABC(_section, false).isZero() : isSameDirection(machineConfiguration.getSpindleAxis(), getForwardDirection(_section))) ||
    settings.workPlaneMethod.optimizeType == OPTIMIZE_HEADS ||
    settings.workPlaneMethod.optimizeType == OPTIMIZE_TABLES ||
    settings.workPlaneMethod.optimizeType == OPTIMIZE_BOTH)) {
    _tcp = false;
  }
  return _tcp;
}
// <<<<< INCLUDED FROM include_files/defineWorkPlane.cpi
// >>>>> INCLUDED FROM include_files/getWorkPlaneMachineABC.cpi
validate(settings.machineAngles, "Setting 'machineAngles' is required but not defined.");
function getWorkPlaneMachineABC(_section, rotate) {
  var currentABC = isFirstSection() ? new Vector(0, 0, 0) : getCurrentABC();
  var abc = _section.getABCByPreference(machineConfiguration, _section.workPlane, currentABC, settings.machineAngles.controllingAxis, settings.machineAngles.type, settings.machineAngles.options);
  if (!isSameDirection(machineConfiguration.getDirection(abc), _section.workPlane.forward)) {
    error(localize("Orientation not supported."));
  }
  if (rotate) {
    if (settings.workPlaneMethod.optimizeType == undefined || settings.workPlaneMethod.useTiltedWorkplane) { // legacy
      var useTCP = false;
      var R = machineConfiguration.getRemainingOrientation(abc, _section.workPlane);
      setRotation(useTCP ? _section.workPlane : R);
    } else {
      if (!_section.isOptimizedForMachine()) {
        machineConfiguration.setToolLength(getSetting("workPlaneMethod.compensateToolLength", false) ? getBodyLength(_section.getTool()) : 0); // define the tool length for head adjustments
        _section.optimize3DPositionsByMachine(machineConfiguration, abc, settings.workPlaneMethod.optimizeType);
      }
    }
  }
  return abc;
}
// <<<<< INCLUDED FROM include_files/getWorkPlaneMachineABC.cpi
// >>>>> INCLUDED FROM include_files/workPlaneFunctions_fanuc.cpi
var gRotationModal = createOutputVariable({current : 69,
  onchange: function () {
    state.twpIsActive = gRotationModal.getCurrent() != 69;
    if (typeof probeVariables != "undefined") {
      probeVariables.outputRotationCodes = probeVariables.probeAngleMethod == "G68";
    }
    machineSimulation({}); // update machine simulation TWP state
  }}, gFormat);

var currentWorkPlaneABC = undefined;
function forceWorkPlane() {
  currentWorkPlaneABC = undefined;
}

function cancelWCSRotation() {
  if (typeof gRotationModal != "undefined" && gRotationModal.getCurrent() == 68) {
    cancelWorkPlane(true);
  }
}

function cancelWorkPlane(force) {
  if (typeof gRotationModal != "undefined") {
    if (force) {
      gRotationModal.reset();
    }
    var command = gRotationModal.format(69);
    if (command) {
      writeBlock(command); // cancel frame
      forceWorkPlane();
    }
  }
}

function setWorkPlane(abc) {
  if (!settings.workPlaneMethod.forceMultiAxisIndexing && is3D() && !machineConfiguration.isMultiAxisConfiguration()) {
    return; // ignore
  }
  var workplaneIsRequired = (currentWorkPlaneABC == undefined) ||
    abcFormat.areDifferent(abc.x, currentWorkPlaneABC.x) ||
    abcFormat.areDifferent(abc.y, currentWorkPlaneABC.y) ||
    abcFormat.areDifferent(abc.z, currentWorkPlaneABC.z);

  writeStartBlocks(workplaneIsRequired, function () {
    writeRetract(Z);
    if (getSetting("retract.homeXY.onIndexing", false)) {
      writeRetract(settings.retract.homeXY.onIndexing);
    }
    if (typeof cancelLengthCompensation == "function") {
      cancelLengthCompensation(); // cancel tool lenght compensation / TCP prior to output TWP
    }
    if (settings.workPlaneMethod.useTiltedWorkplane) {
      onCommand(COMMAND_UNLOCK_MULTI_AXIS);
      cancelWorkPlane();
      if (machineConfiguration.isMultiAxisConfiguration()) {
        var machineABC = abc.isNonZero() ? (currentSection.isMultiAxis() ? getCurrentDirection() : getWorkPlaneMachineABC(currentSection, false)) : abc;
        if (settings.workPlaneMethod.useABCPrepositioning || machineABC.isZero()) {
          positionABC(machineABC);
        } else {
          setCurrentABC(machineABC);
        }
      }
      if (abc.isNonZero() || !machineConfiguration.isMultiAxisConfiguration()) {
        gRotationModal.reset();
        writeBlock(
          gRotationModal.format(68.2), "X" + xyzFormat.format(currentSection.workOrigin.x), "Y" + xyzFormat.format(currentSection.workOrigin.y), "Z" + xyzFormat.format(currentSection.workOrigin.z),
          "I" + abcFormat.format(abc.x), "J" + abcFormat.format(abc.y), "K" + abcFormat.format(abc.z)
        ); // set frame
        writeBlock(gFormat.format(53.1)); // turn machine
        machineSimulation({a:getCurrentABC().x, b:getCurrentABC().y, c:getCurrentABC().z, coordinates:MACHINE, eulerAngles:abc});
      }
    } else {
      positionABC(abc, true);
    }
    if (!currentSection.isMultiAxis()) {
      onCommand(COMMAND_LOCK_MULTI_AXIS);
    }
    currentWorkPlaneABC = abc;
  });
}
// <<<<< INCLUDED FROM include_files/workPlaneFunctions_fanuc.cpi
// >>>>> INCLUDED FROM include_files/positionABC.cpi
function positionABC(abc, force) {
  if (!machineConfiguration.isMultiAxisConfiguration()) {
    error("Function 'positionABC' can only be used with multi-axis machine configurations.");
  }
  if (typeof unwindABC == "function") {
    unwindABC(abc);
  }
  if (force) {
    forceABC();
  }
  var a = aOutput.format(abc.x);
  var b = bOutput.format(abc.y);
  var c = cOutput.format(abc.z);
  if (a || b || c) {
    writeRetract(Z);
    if (getSetting("retract.homeXY.onIndexing", false)) {
      writeRetract(settings.retract.homeXY.onIndexing);
    }
    onCommand(COMMAND_UNLOCK_MULTI_AXIS);
    gMotionModal.reset();
    writeBlock(gMotionModal.format(0), a, b, c);
    setCurrentABC(abc); // required for machine simulation
    machineSimulation({a:abc.x, b:abc.y, c:abc.z, coordinates:MACHINE});
  }
}
// <<<<< INCLUDED FROM include_files/positionABC.cpi
// >>>>> INCLUDED FROM include_files/writeWCS.cpi
function writeWCS(section, wcsIsRequired) {
  if (section.workOffset != currentWorkOffset) {
    if (getSetting("workPlaneMethod.cancelTiltFirst", false) && wcsIsRequired) {
      cancelWorkPlane();
    }
    if (typeof forceWorkPlane == "function" && wcsIsRequired) {
      forceWorkPlane();
    }
    writeStartBlocks(wcsIsRequired, function () {
      writeBlock(section.wcs);
    });
    currentWorkOffset = section.workOffset;
    if (revision >= 50338 && getCurrentSectionId() > 0 && section.workOffset != getPreviousSection().workOffset) {
      simulation.activateWorkCoordsForNextOperation();
    }
  }
}
// <<<<< INCLUDED FROM include_files/writeWCS.cpi
// >>>>> INCLUDED FROM include_files/parametricFeeds.cpi
properties.useParametricFeed = {
  title      : "Parametric feed",
  description: "Specifies that the feedrates should be output using parameters.",
  group      : "preferences",
  type       : "boolean",
  value      : false,
  scope      : "post"
};
var activeMovements;
var currentFeedId;
validate(settings.parametricFeeds, "Setting 'parametricFeeds' is required but not defined.");
function initializeParametricFeeds(insertToolCall) {
  if (getProperty("useParametricFeed") && getParameter("operation-strategy") != "drill" && !currentSection.hasAnyCycle()) {
    if (!insertToolCall && activeMovements && (getCurrentSectionId() > 0) &&
      ((getPreviousSection().getPatternId() == currentSection.getPatternId()) && (currentSection.getPatternId() != 0))) {
      return; // use the current feeds
    }
  } else {
    activeMovements = undefined;
    return;
  }

  activeMovements = new Array();
  var movements = currentSection.getMovements();

  var id = 0;
  var activeFeeds = new Array();
  if (hasParameter("operation:tool_feedCutting")) {
    if (movements & ((1 << MOVEMENT_CUTTING) | (1 << MOVEMENT_LINK_TRANSITION) | (1 << MOVEMENT_EXTENDED))) {
      var feedContext = new FeedContext(id, localize("Cutting"), getParameter("operation:tool_feedCutting"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_CUTTING] = feedContext;
      if (!hasParameter("operation:tool_feedTransition")) {
        activeMovements[MOVEMENT_LINK_TRANSITION] = feedContext;
      }
      activeMovements[MOVEMENT_EXTENDED] = feedContext;
    }
    ++id;
    if (movements & (1 << MOVEMENT_PREDRILL)) {
      feedContext = new FeedContext(id, localize("Predrilling"), getParameter("operation:tool_feedCutting"));
      activeMovements[MOVEMENT_PREDRILL] = feedContext;
      activeFeeds.push(feedContext);
    }
    ++id;
  }
  if (hasParameter("operation:finishFeedrate")) {
    if (movements & (1 << MOVEMENT_FINISH_CUTTING)) {
      var feedContext = new FeedContext(id, localize("Finish"), getParameter("operation:finishFeedrate"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_FINISH_CUTTING] = feedContext;
    }
    ++id;
  } else if (hasParameter("operation:tool_feedCutting")) {
    if (movements & (1 << MOVEMENT_FINISH_CUTTING)) {
      var feedContext = new FeedContext(id, localize("Finish"), getParameter("operation:tool_feedCutting"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_FINISH_CUTTING] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:tool_feedEntry")) {
    if (movements & (1 << MOVEMENT_LEAD_IN)) {
      var feedContext = new FeedContext(id, localize("Entry"), getParameter("operation:tool_feedEntry"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_LEAD_IN] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:tool_feedExit")) {
    if (movements & (1 << MOVEMENT_LEAD_OUT)) {
      var feedContext = new FeedContext(id, localize("Exit"), getParameter("operation:tool_feedExit"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_LEAD_OUT] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:noEngagementFeedrate")) {
    if (movements & (1 << MOVEMENT_LINK_DIRECT)) {
      var feedContext = new FeedContext(id, localize("Direct"), getParameter("operation:noEngagementFeedrate"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_LINK_DIRECT] = feedContext;
    }
    ++id;
  } else if (hasParameter("operation:tool_feedCutting") &&
             hasParameter("operation:tool_feedEntry") &&
             hasParameter("operation:tool_feedExit")) {
    if (movements & (1 << MOVEMENT_LINK_DIRECT)) {
      var feedContext = new FeedContext(id, localize("Direct"), Math.max(getParameter("operation:tool_feedCutting"), getParameter("operation:tool_feedEntry"), getParameter("operation:tool_feedExit")));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_LINK_DIRECT] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:reducedFeedrate")) {
    if (movements & (1 << MOVEMENT_REDUCED)) {
      var feedContext = new FeedContext(id, localize("Reduced"), getParameter("operation:reducedFeedrate"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_REDUCED] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:tool_feedRamp")) {
    if (movements & ((1 << MOVEMENT_RAMP) | (1 << MOVEMENT_RAMP_HELIX) | (1 << MOVEMENT_RAMP_PROFILE) | (1 << MOVEMENT_RAMP_ZIG_ZAG))) {
      var feedContext = new FeedContext(id, localize("Ramping"), getParameter("operation:tool_feedRamp"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_RAMP] = feedContext;
      activeMovements[MOVEMENT_RAMP_HELIX] = feedContext;
      activeMovements[MOVEMENT_RAMP_PROFILE] = feedContext;
      activeMovements[MOVEMENT_RAMP_ZIG_ZAG] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:tool_feedPlunge")) {
    if (movements & (1 << MOVEMENT_PLUNGE)) {
      var feedContext = new FeedContext(id, localize("Plunge"), getParameter("operation:tool_feedPlunge"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_PLUNGE] = feedContext;
    }
    ++id;
  }
  if (true) { // high feed
    if ((movements & (1 << MOVEMENT_HIGH_FEED)) || (highFeedMapping != HIGH_FEED_NO_MAPPING)) {
      var feed;
      if (hasParameter("operation:highFeedrateMode") && getParameter("operation:highFeedrateMode") != "disabled") {
        feed = getParameter("operation:highFeedrate");
      } else {
        feed = this.highFeedrate;
      }
      var feedContext = new FeedContext(id, localize("High Feed"), feed);
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_HIGH_FEED] = feedContext;
      activeMovements[MOVEMENT_RAPID] = feedContext;
    }
    ++id;
  }
  if (hasParameter("operation:tool_feedTransition")) {
    if (movements & (1 << MOVEMENT_LINK_TRANSITION)) {
      var feedContext = new FeedContext(id, localize("Transition"), getParameter("operation:tool_feedTransition"));
      activeFeeds.push(feedContext);
      activeMovements[MOVEMENT_LINK_TRANSITION] = feedContext;
    }
    ++id;
  }

  for (var i = 0; i < activeFeeds.length; ++i) {
    var feedContext = activeFeeds[i];
    var feedDescription = typeof formatComment == "function" ? formatComment(feedContext.description) : feedContext.description;
    writeBlock(settings.parametricFeeds.feedAssignmentVariable + (settings.parametricFeeds.firstFeedParameter + feedContext.id) + "=" + feedFormat.format(feedContext.feed) + SP + feedDescription);
  }
}

function FeedContext(id, description, feed) {
  this.id = id;
  this.description = description;
  this.feed = feed;
}
// <<<<< INCLUDED FROM include_files/parametricFeeds.cpi
// >>>>> INCLUDED FROM include_files/coolant.cpi
var currentCoolantMode = COOLANT_OFF;
var coolantOff = undefined;
var isOptionalCoolant = false;
var forceCoolant = false;

function setCoolant(coolant) {
  var coolantCodes = getCoolantCodes(coolant);
  if (Array.isArray(coolantCodes)) {
    writeStartBlocks(!isOptionalCoolant, function () {
      if (settings.coolant.singleLineCoolant) {
        writeBlock(coolantCodes.join(getWordSeparator()));
      } else {
        for (var c in coolantCodes) {
          writeBlock(coolantCodes[c]);
        }
      }
    });
    return undefined;
  }
  return coolantCodes;
}

function getCoolantCodes(coolant, format) {
  if (!getProperty("useCoolant", true)) {
    return undefined; // coolant output is disabled by property if it exists
  }
  isOptionalCoolant = false;
  if (typeof operationNeedsSafeStart == "undefined") {
    operationNeedsSafeStart = false;
  }
  var multipleCoolantBlocks = new Array(); // create a formatted array to be passed into the outputted line
  var coolants = settings.coolant.coolants;
  if (!coolants) {
    error(localize("Coolants have not been defined."));
  }
  if (tool.type && tool.type == TOOL_PROBE) { // avoid coolant output for probing
    coolant = COOLANT_OFF;
  }
  if (coolant == currentCoolantMode) {
    if (operationNeedsSafeStart && coolant != COOLANT_OFF) {
      isOptionalCoolant = true;
    } else if (!forceCoolant || coolant == COOLANT_OFF) {
      return undefined; // coolant is already active
    }
  }
  if ((coolant != COOLANT_OFF) && (currentCoolantMode != COOLANT_OFF) && (coolantOff != undefined) && !forceCoolant && !isOptionalCoolant) {
    if (Array.isArray(coolantOff)) {
      for (var i in coolantOff) {
        multipleCoolantBlocks.push(coolantOff[i]);
      }
    } else {
      multipleCoolantBlocks.push(coolantOff);
    }
  }
  forceCoolant = false;

  var m;
  var coolantCodes = {};
  for (var c in coolants) { // find required coolant codes into the coolants array
    if (coolants[c].id == coolant) {
      coolantCodes.on = coolants[c].on;
      if (coolants[c].off != undefined) {
        coolantCodes.off = coolants[c].off;
        break;
      } else {
        for (var i in coolants) {
          if (coolants[i].id == COOLANT_OFF) {
            coolantCodes.off = coolants[i].off;
            break;
          }
        }
      }
    }
  }
  if (coolant == COOLANT_OFF) {
    m = !coolantOff ? coolantCodes.off : coolantOff; // use the default coolant off command when an 'off' value is not specified
  } else {
    coolantOff = coolantCodes.off;
    m = coolantCodes.on;
  }

  if (!m) {
    onUnsupportedCoolant(coolant);
    m = 9;
  } else {
    if (Array.isArray(m)) {
      for (var i in m) {
        multipleCoolantBlocks.push(m[i]);
      }
    } else {
      multipleCoolantBlocks.push(m);
    }
    currentCoolantMode = coolant;
    for (var i in multipleCoolantBlocks) {
      if (typeof multipleCoolantBlocks[i] == "number") {
        multipleCoolantBlocks[i] = mFormat.format(multipleCoolantBlocks[i]);
      }
    }
    if (format == undefined || format) {
      return multipleCoolantBlocks; // return the single formatted coolant value
    } else {
      return m; // return unformatted coolant value
    }
  }
  return undefined;
}
// <<<<< INCLUDED FROM include_files/coolant.cpi
// >>>>> INCLUDED FROM include_files/smoothing.cpi
// collected state below, do not edit
validate(settings.smoothing, "Setting 'smoothing' is required but not defined.");
var smoothing = {
  cancel     : false, // cancel tool length prior to update smoothing for this operation
  isActive   : false, // the current state of smoothing
  isAllowed  : false, // smoothing is allowed for this operation
  isDifferent: false, // tells if smoothing levels/tolerances/both are different between operations
  level      : -1, // the active level of smoothing
  tolerance  : -1, // the current operation tolerance
  force      : false // smoothing needs to be forced out in this operation
};

function initializeSmoothing(_section) {
  var _section = _section !== undefined ? _section : currentSection;
  var smoothingSettings = settings.smoothing;
  var previousLevel = smoothing.level;
  var previousTolerance = xyzFormat.getResultingValue(smoothing.tolerance);

  // format threshold parameters
  var thresholdRoughing = xyzFormat.getResultingValue(smoothingSettings.thresholdRoughing);
  var thresholdSemiFinishing = xyzFormat.getResultingValue(smoothingSettings.thresholdSemiFinishing);
  var thresholdFinishing = xyzFormat.getResultingValue(smoothingSettings.thresholdFinishing);

  // determine new smoothing levels and tolerances
  smoothing.level = parseInt(_section.getProperty("useSmoothing"), 10);
  smoothing.level = isNaN(smoothing.level) ? -1 : smoothing.level;
  smoothing.tolerance = xyzFormat.getResultingValue(Math.max(_section.getParameter("operation:tolerance", thresholdFinishing), 0));

  if (smoothing.level == 9999) {
    if (smoothingSettings.autoLevelCriteria == "stock") { // determine auto smoothing level based on stockToLeave
      var stockToLeave = xyzFormat.getResultingValue(_section.getParameter("operation:stockToLeave", _section.getParameter("operation:verticalStockToLeave", 0)));
      var verticalStockToLeave = xyzFormat.getResultingValue(_section.getParameter("operation:verticalStockToLeave", stockToLeave));
      if (((stockToLeave >= thresholdRoughing) && (verticalStockToLeave >= thresholdRoughing)) || _section.getParameter("operation:strategy", "") == "face") {
        smoothing.level = smoothingSettings.roughing; // set roughing level
      } else {
        if (((stockToLeave >= thresholdSemiFinishing) && (stockToLeave < thresholdRoughing)) &&
          ((verticalStockToLeave >= thresholdSemiFinishing) && (verticalStockToLeave < thresholdRoughing))) {
          smoothing.level = smoothingSettings.semi; // set semi level
        } else if (((stockToLeave >= thresholdFinishing) && (stockToLeave < thresholdSemiFinishing)) &&
          ((verticalStockToLeave >= thresholdFinishing) && (verticalStockToLeave < thresholdSemiFinishing))) {
          smoothing.level = smoothingSettings.semifinishing; // set semi-finishing level
        } else {
          smoothing.level = smoothingSettings.finishing; // set finishing level
        }
      }
    } else { // detemine auto smoothing level based on operation tolerance instead of stockToLeave
      if (smoothing.tolerance >= thresholdRoughing || _section.getParameter("operation:strategy", "") == "face") {
        smoothing.level = smoothingSettings.roughing; // set roughing level
      } else {
        if (((smoothing.tolerance >= thresholdSemiFinishing) && (smoothing.tolerance < thresholdRoughing))) {
          smoothing.level = smoothingSettings.semi; // set semi level
        } else if (((smoothing.tolerance >= thresholdFinishing) && (smoothing.tolerance < thresholdSemiFinishing))) {
          smoothing.level = smoothingSettings.semifinishing; // set semi-finishing level
        } else {
          smoothing.level = smoothingSettings.finishing; // set finishing level
        }
      }
    }
  }

  if (smoothing.level == -1) { // useSmoothing is disabled
    smoothing.isAllowed = false;
  } else {
    smoothing.isAllowed = !(_section.getTool().type == TOOL_PROBE || isDrillingCycle(_section)) || (_section.isConnectionSection && _section.isConnectionSection() && _section.isMultiAxis());
    if (isFirstSection()) {
      smoothing.isActive = undefined;
    }
  }
  if (!smoothing.isAllowed) {
    smoothing.level = -1;
    smoothing.tolerance = -1;
  }

  switch (smoothingSettings.differenceCriteria) {
  case "level":
    smoothing.isDifferent = smoothing.level != previousLevel;
    break;
  case "tolerance":
    smoothing.isDifferent = smoothing.tolerance != previousTolerance;
    break;
  case "both":
    smoothing.isDifferent = smoothing.level != previousLevel || smoothing.tolerance != previousTolerance;
    break;
  default:
    error(localize("Unsupported smoothing criteria."));
    return;
  }

  // tool length compensation needs to be canceled when smoothing state/level changes
  if (smoothingSettings.cancelCompensation) {
    smoothing.cancel = !isFirstSection() && smoothing.isDifferent;
  }
}
// <<<<< INCLUDED FROM include_files/smoothing.cpi
// >>>>> INCLUDED FROM include_files/writeProgramHeader.cpi
properties.writeMachine = {
  title      : "Write machine",
  description: "Output the machine settings in the header of the program.",
  group      : "formats",
  type       : "boolean",
  value      : true,
  scope      : "post"
};
properties.writeTools = {
  title      : "Write tool list",
  description: "Output a tool list in the header of the program.",
  group      : "formats",
  type       : "boolean",
  value      : true,
  scope      : "post"
};
function writeProgramHeader() {
  // DWY  >>> APW 4.4a  posted timestamp + source file name
  var now = new Date();
  writeComment("    POSTED: " + (now.getMonth() + 1) + "." + now.getDate() + "." + now.getFullYear() +
    " " + now.getHours() + ".." + now.getMinutes());
  if (hasGlobalParameter("document-path")) {
    var path = getGlobalParameter("document-path");
    if (path) {
      writeComment("    FILE NAME: " + path);
    }
  }
  // <<< APW 4.4a

  // 7.2 dwy
  if (getProperty("fixtureInfo")) {
  writeComment("FIXTURE = " + getProperty("fixtureInfo"));
  }

  // dump machine configuration
  var vendor = machineConfiguration.getVendor();
  var model = machineConfiguration.getModel();
  var mDescription = machineConfiguration.getDescription();
  if (getProperty("writeMachine") && (vendor || model || mDescription)) {
    writeComment(localize("Machine"));
    if (vendor) {
      writeComment("  " + localize("vendor") + ": " + vendor);
    }
    if (model) {
      writeComment("  " + localize("model") + ": " + model);
    }
    // DWY APW 4.4b  machine description suppressed on purpose (was: writeComment description)
  }

  // DWY >>> APW 8.1  stamp which post produced this program
  //   "description" is the global post description set at the top of this file, the same
  //   string Fusion shows in the post library. Written unconditionally, i.e. NOT inside the
  //   writeMachine gate above, so the stamp is present even when the machine block is off.
  //   Note the machine block deliberately uses mDescription for the machine text so it does
  //   not shadow this global.
  writeComment("  " + localize("post") + ": " + description); // APW 8.4  indented to match vendor/model
  // <<< APW 8.1

  // dump tool information
  if (getProperty("writeTools")) {
    if (false) { // set to true to use the post kernel version of the tool list
      writeToolTable(TOOL_NUMBER_COL);
    } else {
      var zRanges = {};
      if (is3D()) {
        var numberOfSections = getNumberOfSections();
        for (var i = 0; i < numberOfSections; ++i) {
          var section = getSection(i);
          var zRange = section.getGlobalZRange();
          var tool = section.getTool();
          if (zRanges[tool.number]) {
            zRanges[tool.number].expandToRange(zRange);
          } else {
            zRanges[tool.number] = zRange;
          }
        }
      }
      var tools = getToolTable();
      if (tools.getNumberOfTools() > 0) {
        // APW 8.4: fence the tool list off from the machine block above and whatever
        // follows. Same separator string used in the tool setting block, so the two look
        // like one family. Plain hyphens - see the note on measureToolsSeparator.
        writeComment(measureToolsSeparator);
        for (var i = 0; i < tools.getNumberOfTools(); ++i) {
          var tool = tools.getTool(i);
          // >>> APW 4.4c  tool list format: description / holder / OOH / prod id / vendor
          // stock D= and CR= output intentionally removed
          // APW 8.0d: body moved into buildApwToolComment() so the tool measuring block can
          //          reuse the exact same format. Header keeps the location field.
          var comment = buildApwToolComment(tool, true);
          // stock TAPER / ZMIN / tool type output intentionally removed
          // <<< APW 4.4c
          writeComment(comment);
        }
        writeComment(measureToolsSeparator); // APW 8.4  close the tool list
      }
    }
  }

  // DWY >>> APW 4.2b  seed the Blum work-offset shift macro variables
  writeln("");
  writeln("");
  if (getProperty("probeShiftX")) {
    var xShift = getProperty("ShiftXValue");
    writeComment("PROBING WORKOFFSET SHIFT IN X/I = #190");
    writeln("#190 = " + xyzFormat.format(xShift));
  }
  if (getProperty("probeShiftY")) {
    var yShift = getProperty("ShiftYValue");
    writeComment("PROBING WORKOFFSET SHIFT IN Y/J = #191");
    writeln("#191 = " + xyzFormat.format(yShift));
  }
  if (getProperty("probeShiftZ")) {
    var zShift = getProperty("ShiftZValue");
    writeComment("PROBING WORKOFFSET SHIFT IN Z/K = #192");
    writeln("#192 = " + xyzFormat.format(zShift));
  }
  writeln("");
  writeln("");
  // <<< APW 4.2b
}
// <<<<< INCLUDED FROM include_files/writeProgramHeader.cpi

// >>>>> INCLUDED FROM include_files/onRapid_fanuc.cpi
function onRapid(_x, _y, _z) {
  var x = xOutput.format(_x);
  var y = yOutput.format(_y);
  var z = zOutput.format(_z);
  if (x || y || z) {
    if (pendingRadiusCompensation >= 0) {
      error(localize("Radius compensation mode cannot be changed at rapid traversal."));
      return;
    }
    writeBlock(gMotionModal.format(0), x, y, z);
    forceFeed();
  }
}
// <<<<< INCLUDED FROM include_files/onRapid_fanuc.cpi
// >>>>> INCLUDED FROM include_files/onRapid5D_fanuc.cpi
function onRapid5D(_x, _y, _z, _a, _b, _c) {
  if (pendingRadiusCompensation >= 0) {
    error(localize("Radius compensation mode cannot be changed at rapid traversal."));
    return;
  }
  if (!currentSection.isOptimizedForMachine()) {
    forceXYZ();
  }
  var x = xOutput.format(_x);
  var y = yOutput.format(_y);
  var z = zOutput.format(_z);
  var a = currentSection.isOptimizedForMachine() ? aOutput.format(_a) : toolVectorOutputI.format(_a);
  var b = currentSection.isOptimizedForMachine() ? bOutput.format(_b) : toolVectorOutputJ.format(_b);
  var c = currentSection.isOptimizedForMachine() ? cOutput.format(_c) : toolVectorOutputK.format(_c);

  if (x || y || z || a || b || c) {
    writeBlock(gMotionModal.format(0), x, y, z, a, b, c);
    forceFeed();
  }
}
// <<<<< INCLUDED FROM include_files/onRapid5D_fanuc.cpi
// >>>>> INCLUDED FROM include_files/onLinear5D_fanuc.cpi
function onLinear5D(_x, _y, _z, _a, _b, _c, feed, feedMode) {
  if (pendingRadiusCompensation >= 0) {
    error(localize("Radius compensation cannot be activated/deactivated for 5-axis move."));
    return;
  }
  if (!currentSection.isOptimizedForMachine()) {
    forceXYZ();
  }
  var x = xOutput.format(_x);
  var y = yOutput.format(_y);
  var z = zOutput.format(_z);
  var a = currentSection.isOptimizedForMachine() ? aOutput.format(_a) : toolVectorOutputI.format(_a);
  var b = currentSection.isOptimizedForMachine() ? bOutput.format(_b) : toolVectorOutputJ.format(_b);
  var c = currentSection.isOptimizedForMachine() ? cOutput.format(_c) : toolVectorOutputK.format(_c);
  if (feedMode == FEED_INVERSE_TIME) {
    forceFeed();
  }
  var f = feedMode == FEED_INVERSE_TIME ? inverseTimeOutput.format(feed) : getFeed(feed);
  var fMode = feedMode == FEED_INVERSE_TIME ? 93 : getProperty("useG95") ? 95 : 94;

  if (x || y || z || a || b || c) {
    writeBlock(gFeedModeModal.format(fMode), gMotionModal.format(1), x, y, z, a, b, c, f);
  } else if (f) {
    if (getNextRecord().isMotion()) { // try not to output feed without motion
      forceFeed(); // force feed on next line
    } else {
      writeBlock(gFeedModeModal.format(fMode), gMotionModal.format(1), f);
    }
  }
}
// <<<<< INCLUDED FROM include_files/onLinear5D_fanuc.cpi
// >>>>> INCLUDED FROM include_files/onCircular_fanuc.cpi
function onCircular(clockwise, cx, cy, cz, x, y, z, feed) {
  if (pendingRadiusCompensation >= 0) {
    error(localize("Radius compensation cannot be activated/deactivated for a circular move."));
    return;
  }

  var start = getCurrentPosition();

  if (isFullCircle()) {
    if (getProperty("useRadius") || isHelical()) { // radius mode does not support full arcs
      linearize(tolerance);
      return;
    }
    switch (getCircularPlane()) {
    case PLANE_XY:
      writeBlock(gPlaneModal.format(17), gMotionModal.format(clockwise ? 2 : 3), iOutput.format(cx - start.x), jOutput.format(cy - start.y), getFeed(feed));
      break;
    case PLANE_ZX:
      writeBlock(gPlaneModal.format(18), gMotionModal.format(clockwise ? 2 : 3), iOutput.format(cx - start.x), kOutput.format(cz - start.z), getFeed(feed));
      break;
    case PLANE_YZ:
      writeBlock(gPlaneModal.format(19), gMotionModal.format(clockwise ? 2 : 3), jOutput.format(cy - start.y), kOutput.format(cz - start.z), getFeed(feed));
      break;
    default:
      linearize(tolerance);
    }
  } else if (!getProperty("useRadius")) {
    switch (getCircularPlane()) {
    case PLANE_XY:
      writeBlock(gPlaneModal.format(17), gMotionModal.format(clockwise ? 2 : 3), xOutput.format(x), yOutput.format(y), zOutput.format(z), iOutput.format(cx - start.x), jOutput.format(cy - start.y), getFeed(feed));
      break;
    case PLANE_ZX:
      writeBlock(gPlaneModal.format(18), gMotionModal.format(clockwise ? 2 : 3), xOutput.format(x), yOutput.format(y), zOutput.format(z), iOutput.format(cx - start.x), kOutput.format(cz - start.z), getFeed(feed));
      break;
    case PLANE_YZ:
      writeBlock(gPlaneModal.format(19), gMotionModal.format(clockwise ? 2 : 3), xOutput.format(x), yOutput.format(y), zOutput.format(z), jOutput.format(cy - start.y), kOutput.format(cz - start.z), getFeed(feed));
      break;
    default:
      if (getProperty("allow3DArcs")) {
        // make sure maximumCircularSweep is well below 360deg
        // we could use G02.4 or G03.4 - direction is calculated
        var ip = getPositionU(0.5);
        writeBlock(gMotionModal.format(clockwise ? 2.4 : 3.4), xOutput.format(ip.x), yOutput.format(ip.y), zOutput.format(ip.z), getFeed(feed));
        writeBlock(xOutput.format(x), yOutput.format(y), zOutput.format(z));
      } else {
        linearize(tolerance);
      }
    }
  } else { // use radius mode
    var r = getCircularRadius();
    if (toDeg(getCircularSweep()) > (180 + 1e-9)) {
      r = -r; // allow up to <360 deg arcs
    }
    switch (getCircularPlane()) {
    case PLANE_XY:
      writeBlock(gPlaneModal.format(17), gMotionModal.format(clockwise ? 2 : 3), xOutput.format(x), yOutput.format(y), zOutput.format(z), "R" + rFormat.format(r), getFeed(feed));
      break;
    case PLANE_ZX:
      writeBlock(gPlaneModal.format(18), gMotionModal.format(clockwise ? 2 : 3), xOutput.format(x), yOutput.format(y), zOutput.format(z), "R" + rFormat.format(r), getFeed(feed));
      break;
    case PLANE_YZ:
      writeBlock(gPlaneModal.format(19), gMotionModal.format(clockwise ? 2 : 3), xOutput.format(x), yOutput.format(y), zOutput.format(z), "R" + rFormat.format(r), getFeed(feed));
      break;
    default:
      if (getProperty("allow3DArcs")) {
        // make sure maximumCircularSweep is well below 360deg
        // we could use G02.4 or G03.4 - direction is calculated
        var ip = getPositionU(0.5);
        writeBlock(gMotionModal.format(clockwise ? 2.4 : 3.4), xOutput.format(ip.x), yOutput.format(ip.y), zOutput.format(ip.z), getFeed(feed));
        writeBlock(xOutput.format(x), yOutput.format(y), zOutput.format(z));
      } else {
        linearize(tolerance);
      }
    }
  }
}
// <<<<< INCLUDED FROM include_files/onCircular_fanuc.cpi
// >>>>> INCLUDED FROM include_files/rewind.cpi
function onMoveToSafeRetractPosition() {
  if (!getSetting("allowCancelTCPBeforeRetracting", false)) {
    writeRetract(Z);
  }
  if (state.tcpIsActive) { // cancel TCP so that tool doesn't follow rotaries
    setTCP(false);
  }
  writeRetract(Z);
  if (getSetting("retract.homeXY.onIndexing", false)) {
    writeRetract(settings.retract.homeXY.onIndexing);
  }
}

/** Rotate axes to new position above reentry position */
function onRotateAxes(_x, _y, _z, _a, _b, _c) {
  // position rotary axes
  xOutput.disable();
  yOutput.disable();
  zOutput.disable();
  if (typeof unwindABC == "function") {
    unwindABC(new Vector(_a, _b, _c), false);
  }
  onRapid5D(_x, _y, _z, _a, _b, _c);
  setCurrentABC(new Vector(_a, _b, _c));
  machineSimulation({a:_a, b:_b, c:_c, coordinates:MACHINE});
  xOutput.enable();
  yOutput.enable();
  zOutput.enable();
  forceXYZ();
}

/** Return from safe position after indexing rotaries. */
function onReturnFromSafeRetractPosition(_x, _y, _z) {
  if (!machineConfiguration.isHeadConfiguration()) {
    writeInitialPositioning(new Vector(_x, _y, _z), true);
    if (highFeedMapping != HIGH_FEED_NO_MAPPING) {
      onLinear5D(_x, _y, _z, getCurrentDirection().x, getCurrentDirection().y, getCurrentDirection().z, highFeedrate);
    } else {
      onRapid5D(_x, _y, _z, getCurrentDirection().x, getCurrentDirection().y, getCurrentDirection().z);
    }
    machineSimulation({x:_x, y:_y, z:_z, a:getCurrentDirection().x, b:getCurrentDirection().y, c:getCurrentDirection().z});
  } else {
    if (tcp.isSupportedByOperation) {
      setTCP(true);
    }
    forceXYZ();
    xOutput.reset();
    yOutput.reset();
    zOutput.disable();
    if (highFeedMapping != HIGH_FEED_NO_MAPPING) {
      onLinear(_x, _y, _z, highFeedrate);
    } else {
      onRapid(_x, _y, _z);
    }
    machineSimulation({x:_x, y:_y});
    zOutput.enable();
    invokeOnRapid(_x, _y, _z);
  }
}
// <<<<< INCLUDED FROM include_files/rewind.cpi
// >>>>> INCLUDED FROM include_files/commonInspectionFunctions_fanuc.cpi
var macroFormat = createFormat({prefix:(typeof inspectionVariables == "undefined" ? "#" : inspectionVariables.localVariablePrefix), decimals:0});
var macroRoundingFormat = (unit == MM) ? "[53]" : "[44]";
var isDPRNTopen = false;

var WARNING_OUTDATED = 0;
var toolpathIdFormat = createFormat({decimals:5, type:FORMAT_REAL});
var patternInstances = new Array();
var initializePatternInstances = true; // initialize patternInstances array the first time inspectionGetToolpathId is called
function inspectionGetToolpathId(section) {
  if (initializePatternInstances) {
    for (var i = 0; i < getNumberOfSections(); ++i) {
      var _section = getSection(i);
      if (_section.getInternalPatternId) {
        var sectionId = _section.getId();
        var patternId = _section.getInternalPatternId();
        var isPatterned = _section.isPatterned && _section.isPatterned();
        var isMirrored = patternId != _section.getPatternId();
        if (isPatterned || isMirrored) {
          var isKnownPatternId = false;
          for (var j = 0; j < patternInstances.length; j++) {
            if (patternId == patternInstances[j].patternId) {
              patternInstances[j].patternIndex++;
              patternInstances[j].sections.push(sectionId);
              isKnownPatternId = true;
              break;
            }
          }
          if (!isKnownPatternId) {
            patternInstances.push({patternId:patternId, patternIndex:1, sections:[sectionId]});
          }
        }
      }
    }
    initializePatternInstances = false;
  }

  var _operationId = section.getParameter("autodeskcam:operation-id", "");
  var key = -1;
  for (k in patternInstances) {
    if (patternInstances[k].patternId == _operationId) {
      key = k;
      break;
    }
  }
  var _patternId = (key > -1) ? patternInstances[key].sections.indexOf(section.getId()) + 1 : 0;
  var _cycleId = cycle && ("cycleID" in cycle) ? cycle.cycleID : section.getParameter("cycleID", 0);
  if (isProbeOperation(section) && _cycleId == 0 && getGlobalParameter("product-id").toLowerCase().indexOf("fusion") > -1) {
    // we expect the cycleID to be non zero always for macro probing toolpaths, Fusion only
    warningOnce(localize("Outdated macro probing operations detected. Please regenerate all macro probing operations."), WARNING_OUTDATED);
  }
  if (_patternId > 99) {
    error(subst(localize("The maximum number of pattern instances is limited to 99" + EOL +
      "You need to split operation '%1' into separate pattern groups."
    ), section.getParameter("operation-comment", "")));
  }
  if (_cycleId > 99) {
    error(subst(localize("The maximum number of probing cycles is limited to 99" + EOL +
      "You need to split operation '%1' to multiple operations with less than 100 cycles in each operation."
    ), section.getParameter("operation-comment", "")));
  }
  return toolpathIdFormat.format(_operationId + (_cycleId * 0.01) + (_patternId * 0.0001) + 0.00001);
}

var localVariableStart = 19;
var localVariable = [
  macroFormat.format(localVariableStart + 1),
  macroFormat.format(localVariableStart + 2),
  macroFormat.format(localVariableStart + 3),
  macroFormat.format(localVariableStart + 4),
  macroFormat.format(localVariableStart + 5),
  macroFormat.format(localVariableStart + 6)
];

function defineLocalVariable(indx, value) {
  writeln(localVariable[indx - 1] + " = " + value);
}

function formatLocalVariable(prefix, indx, rnd) {
  return prefix + localVariable[indx - 1] + rnd;
}

function inspectionCreateResultsFileHeader() {
  if (isDPRNTopen) {
    if (!getProperty("singleResultsFile")) {
      writeln("DPRNT[END]");
      writeBlock("PCLOS");
      isDPRNTopen = false;
    }
  }

  if (isProbeOperation() && !printProbeResults()) {
    return; // if print results is not desired by probe/ probeWCS
  }

  if (!isDPRNTopen) {
    writeBlock("PCLOS");
    writeBlock("POPEN");
    // check for existence of none alphanumeric characters but not spaces
    var resFile;
    if (getProperty("singleResultsFile")) {
      resFile = getParameter("job-description") + "-RESULTS";
    } else {
      resFile = getParameter("operation-comment") + "-RESULTS";
    }
    resFile = resFile.replace(/:/g, "-");
    resFile = resFile.replace(/[^a-zA-Z0-9 -]/g, "");
    resFile = resFile.replace(/\s/g, "-");
    resFile = resFile.toUpperCase();
    writeln("DPRNT[START]");
    writeln("DPRNT[RESULTSFILE*" + resFile + "]");
    if (hasGlobalParameter("document-id")) {
      writeln("DPRNT[DOCUMENTID*" + getGlobalParameter("document-id").toUpperCase() + "]");
    }
    if (hasGlobalParameter("model-version")) {
      writeln("DPRNT[MODELVERSION*" + getGlobalParameter("model-version").toUpperCase() + "]");
    }
  }
  if (isProbeOperation() && printProbeResults()) {
    isDPRNTopen = true;
  }
}

function getPointNumber() {
  if (typeof inspectionWriteVariables == "function") {
    return (inspectionVariables.pointNumber);
  } else {
    return ("#122[60]");
  }
}

function inspectionWriteCADTransform() {
  var cadOrigin = currentSection.getModelOrigin();
  var cadWorkPlane = currentSection.getModelPlane().getTransposed();
  var cadEuler = cadWorkPlane.getEuler2(EULER_XYZ_S);
  defineLocalVariable(1, abcFormat.format(cadEuler.x));
  defineLocalVariable(2, abcFormat.format(cadEuler.y));
  defineLocalVariable(3, abcFormat.format(cadEuler.z));
  defineLocalVariable(4, xyzFormat.format(-cadOrigin.x));
  defineLocalVariable(5, xyzFormat.format(-cadOrigin.y));
  defineLocalVariable(6, xyzFormat.format(-cadOrigin.z));
  writeln(
    "DPRNT[G331" +
    "*N" + getPointNumber() +
    formatLocalVariable("*A", 1, macroRoundingFormat) +
    formatLocalVariable("*B", 2, macroRoundingFormat) +
    formatLocalVariable("*C", 3, macroRoundingFormat) +
    formatLocalVariable("*X", 4, macroRoundingFormat) +
    formatLocalVariable("*Y", 5, macroRoundingFormat) +
    formatLocalVariable("*Z", 6, macroRoundingFormat) +
    "]"
  );
}

function inspectionWriteWorkplaneTransform() {
  var orientation = machineConfiguration.isMultiAxisConfiguration() ? machineConfiguration.getOrientation(getCurrentDirection()) : currentSection.workPlane;
  var abc = orientation.getEuler2(EULER_XYZ_S);
  if (getProperty("useLiveConnection")) {
    liveConnectorInterface("WORKPLANE");
    writeln(inspectionVariables.liveConnectionWPA + " = " + abcFormat.format(abc.x));
    writeln(inspectionVariables.liveConnectionWPB + " = " + abcFormat.format(abc.y));
    writeln(inspectionVariables.liveConnectionWPC + " = " + abcFormat.format(abc.z));
    writeBlock("IF [" + inspectionVariables.workplaneStartAddress, "NE -1] GOTO" + skipNLines(2));
    writeBlock(inspectionVariables.workplaneStartAddress, "=", inspectionGetToolpathId(currentSection));
    writeBlock(" "); // do not remove, required for GOTO functionality
  }

  defineLocalVariable(1, abcFormat.format(abc.x));
  defineLocalVariable(2, abcFormat.format(abc.y));
  defineLocalVariable(3, abcFormat.format(abc.z));
  writeln("DPRNT[G330" +
    "*N" + getPointNumber() +
    formatLocalVariable("*A", 1, macroRoundingFormat) +
    formatLocalVariable("*B", 2, macroRoundingFormat) +
    formatLocalVariable("*C", 3, macroRoundingFormat) +
    "*X0*Y0*Z0*I0*R0]"
  );
}

function writeProbingToolpathInformation(cycleDepth) {
  writeln("DPRNT[TOOLPATHID*" + inspectionGetToolpathId(currentSection) + "]");
  if (isInspectionOperation()) {
    writeln("DPRNT[TOOLPATH*" + getParameter("operation-comment").toUpperCase().replace(/[()]/g, "") + "]");
  } else {
    defineLocalVariable(2, xyzFormat.format(cycleDepth));
    writeln(formatLocalVariable("DPRNT[CYCLEDEPTH*", 2, macroRoundingFormat + "]"));
  }
}
// <<<<< INCLUDED FROM include_files/commonInspectionFunctions_fanuc.cpi
// >>>>> INCLUDED FROM include_files/setProbeAngle_fanuc.cpi
function setProbeAngle() {
  if (probeVariables.outputRotationCodes) {
    // APW 8.0g: pick the variable set that matches the configured probing type
    var probeAngleVariables = settings.probing.probeAngleVariables[getProperty("probingType")];
    validate(probeAngleVariables, localize("Setting 'probing.probeAngleVariables' is required for angular probing."));
    var px = probeAngleVariables.x;
    var py = probeAngleVariables.y;
    var pz = probeAngleVariables.z;
    var pi = probeAngleVariables.i;
    var pj = probeAngleVariables.j;
    var pk = probeAngleVariables.k;
    var pr = probeAngleVariables.r;
    var baseParamG54x4 = probeAngleVariables.baseParamG54x4;
    var baseParamAxisRot = probeAngleVariables.baseParamAxisRot;
    var probeOutputWorkOffset = currentSection.probeWorkOffset;

    validate(probeOutputWorkOffset <= 6, "Angular Probing only supports work offsets 1-6.");
    if (probeVariables.probeAngleMethod == "G68" && (Vector.diff(currentSection.getGlobalInitialToolAxis(), new Vector(0, 0, 1)).length > 1e-4)) {
      error(localize("You cannot use multi axis toolpaths while G68 Rotation is in effect."));
    }
    var validateWorkOffset = false;
    switch (probeVariables.probeAngleMethod) {
    case "G54.4":
      var param = baseParamG54x4 + (probeOutputWorkOffset * 10);
      writeBlock("#" + param + "=" + px);
      writeBlock("#" + (param + 1) + "=" + py);
      writeBlock("#" + (param + 5) + "=" + pr);
      writeBlock(gFormat.format(54.4), "P" + probeOutputWorkOffset);
      break;
    case "G68":
      gRotationModal.reset();
      gAbsIncModal.reset();
      var xy = probeVariables.compensationXY || formatWords(formatCompensationParameter("X", px), formatCompensationParameter("Y", py));
      writeBlock(
        gRotationModal.format(68), gAbsIncModal.format(90),
        xy,
        formatCompensationParameter("Z", pz),
        formatCompensationParameter("I", pi),
        formatCompensationParameter("J", pj),
        formatCompensationParameter("K", pk),
        formatCompensationParameter("R", pr)
      );
      validateWorkOffset = true;
      break;
    case "AXIS_ROT":
      var param = baseParamAxisRot + probeOutputWorkOffset * 20 + probeVariables.rotaryTableAxis + 4;
      writeBlock("#" + param + " = " + "[#" + param + " + " + pr + "]");
      forceWorkPlane(); // force workplane to rotate ABC in order to apply rotation offsets
      currentWorkOffset = undefined; // force WCS output to make use of updated parameters
      validateWorkOffset = true;
      break;
    default:
      error(localize("Angular Probing is not supported for this machine configuration."));
      return;
    }
    if (validateWorkOffset) {
      for (var i = currentSection.getId(); i < getNumberOfSections(); ++i) {
        if (getSection(i).workOffset != currentSection.workOffset) {
          error(localize("WCS offset cannot change while using angle rotation compensation."));
          return;
        }
      }
    }
    probeVariables.outputRotationCodes = false;
  }
}

function formatCompensationParameter(label, value) {
  return typeof value == "string" ? label + "[" + value + "]" : typeof value == "number" ? label + xyzFormat.format(value) : "";
}
// <<<<< INCLUDED FROM include_files/setProbeAngle_fanuc.cpi
// >>>>> INCLUDED FROM include_files/setProbeAngleMethod.cpi
function setProbeAngleMethod() {
  var axisRotIsSupported = false;
  var axes = [machineConfiguration.getAxisU(), machineConfiguration.getAxisV(), machineConfiguration.getAxisW()];
  for (var i = 0; i < axes.length; ++i) {
    if (axes[i].isEnabled() && isSameDirection((axes[i].getAxis()).getAbsolute(), new Vector(0, 0, 1)) && axes[i].isTable()) {
      axisRotIsSupported = true;
      // APW 8.0g: probeAngleVariables is now keyed by probing type, so index it here too.
      // Without this the lookup returns undefined, undefined == 0 is false, and the post
      // would silently fall through to the Haas branch on a Fanuc-style control.
      if (settings.probing.probeAngleVariables[getProperty("probingType")].method == 0) { // Fanuc
        validate(i < 2, localize("Rotary table axis is invalid."));
        probeVariables.rotaryTableAxis = i;
      } else { // Haas
        probeVariables.rotaryTableAxis = axes[i].getCoordinate();
      }
      break;
    }
  }
  if (settings.probing.probeAngleMethod == undefined) {
    probeVariables.probeAngleMethod = axisRotIsSupported ? "AXIS_ROT" : getProperty("useG54x4") ? "G54.4" : "G68"; // automatic selection
  } else {
    probeVariables.probeAngleMethod = settings.probing.probeAngleMethod; // use probeAngleMethod from settings
    if (probeVariables.probeAngleMethod == "AXIS_ROT" && !axisRotIsSupported) {
      error(localize("Setting probeAngleMethod 'AXIS_ROT' is not supported on this machine."));
    }
  }
  probeVariables.outputRotationCodes = true;
}
// <<<<< INCLUDED FROM include_files/setProbeAngleMethod.cpi
