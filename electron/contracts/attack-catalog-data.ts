// Generated from MITRE ATT&CK Enterprise v19.1 STIX data (official MITRE release).
// Source: https://github.com/mitre-attack/attack-stix-data/releases/tag/v19.1
// Runtime is intentionally offline; update this file only when the pinned catalog version changes.

export interface AttackCatalogTactic {
  id: string;
  name: string;
  description: string;
}

export interface AttackCatalogTechnique {
  id: string;
  name: string;
  tacticIds: string[];
  isSubTechnique: boolean;
  parentId?: string;
}

export const ATTACK_CATALOG_VERSION = '19.1';

export const ATTACK_TACTICS: AttackCatalogTactic[] = [
  {
    "id": "TA0043",
    "name": "Reconnaissance",
    "description": "Gather information to plan future operations"
  },
  {
    "id": "TA0042",
    "name": "Resource Development",
    "description": "Establish resources to support operations"
  },
  {
    "id": "TA0001",
    "name": "Initial Access",
    "description": "Gain initial access to a target"
  },
  {
    "id": "TA0002",
    "name": "Execution",
    "description": "Run malicious or operator-controlled code"
  },
  {
    "id": "TA0003",
    "name": "Persistence",
    "description": "Maintain access across interruptions"
  },
  {
    "id": "TA0004",
    "name": "Privilege Escalation",
    "description": "Gain higher-level permissions"
  },
  {
    "id": "TA0005",
    "name": "Stealth",
    "description": "Avoid detection and defensive controls"
  },
  {
    "id": "TA0112",
    "name": "Defense Impairment",
    "description": "Break security mechanisms, pipelines, and tooling"
  },
  {
    "id": "TA0006",
    "name": "Credential Access",
    "description": "Steal account names and credentials"
  },
  {
    "id": "TA0007",
    "name": "Discovery",
    "description": "Discover systems, services, and accounts"
  },
  {
    "id": "TA0008",
    "name": "Lateral Movement",
    "description": "Move through the environment"
  },
  {
    "id": "TA0009",
    "name": "Collection",
    "description": "Gather data of interest"
  },
  {
    "id": "TA0011",
    "name": "Command and Control",
    "description": "Communicate with compromised systems"
  },
  {
    "id": "TA0010",
    "name": "Exfiltration",
    "description": "Steal data from the environment"
  },
  {
    "id": "TA0040",
    "name": "Impact",
    "description": "Manipulate or interrupt availability and integrity"
  }
];

export const ATTACK_TECHNIQUES: AttackCatalogTechnique[] = [
  {
    "id": "T1001",
    "name": "Data Obfuscation",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1001.001",
    "name": "Junk Data",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1001"
  },
  {
    "id": "T1001.002",
    "name": "Steganography",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1001"
  },
  {
    "id": "T1001.003",
    "name": "Protocol or Service Impersonation",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1001"
  },
  {
    "id": "T1003",
    "name": "OS Credential Dumping",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1003.001",
    "name": "LSASS Memory",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.002",
    "name": "Security Account Manager",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.003",
    "name": "NTDS",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.004",
    "name": "LSA Secrets",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.005",
    "name": "Cached Domain Credentials",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.006",
    "name": "DCSync",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.007",
    "name": "Proc Filesystem",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1003.008",
    "name": "/etc/passwd and /etc/shadow",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1003"
  },
  {
    "id": "T1005",
    "name": "Data from Local System",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1006",
    "name": "Direct Volume Access",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1007",
    "name": "System Service Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1008",
    "name": "Fallback Channels",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1010",
    "name": "Application Window Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1011",
    "name": "Exfiltration Over Other Network Medium",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1011.001",
    "name": "Exfiltration Over Bluetooth",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1011"
  },
  {
    "id": "T1012",
    "name": "Query Registry",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1014",
    "name": "Rootkit",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1016",
    "name": "System Network Configuration Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1016.001",
    "name": "Internet Connection Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1016"
  },
  {
    "id": "T1016.002",
    "name": "Wi-Fi Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1016"
  },
  {
    "id": "T1018",
    "name": "Remote System Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1020",
    "name": "Automated Exfiltration",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1020.001",
    "name": "Traffic Duplication",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1020"
  },
  {
    "id": "T1021",
    "name": "Remote Services",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1021.001",
    "name": "Remote Desktop Protocol",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.002",
    "name": "SMB/Windows Admin Shares",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.003",
    "name": "Distributed Component Object Model",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.004",
    "name": "SSH",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.005",
    "name": "VNC",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.006",
    "name": "Windows Remote Management",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.007",
    "name": "Cloud Services",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1021.008",
    "name": "Direct Cloud VM Connections",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1021"
  },
  {
    "id": "T1025",
    "name": "Data from Removable Media",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1027",
    "name": "Obfuscated Files or Information",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1027.001",
    "name": "Binary Padding",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.002",
    "name": "Software Packing",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.003",
    "name": "Steganography",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.004",
    "name": "Compile After Delivery",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.005",
    "name": "Indicator Removal from Tools",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.006",
    "name": "HTML Smuggling",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.007",
    "name": "Dynamic API Resolution",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.008",
    "name": "Stripped Payloads",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.009",
    "name": "Embedded Payloads",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.010",
    "name": "Command Obfuscation",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.011",
    "name": "Fileless Storage",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.012",
    "name": "LNK Icon Smuggling",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.013",
    "name": "Encrypted/Encoded File",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.014",
    "name": "Polymorphic Code",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.015",
    "name": "Compression",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.016",
    "name": "Junk Code Insertion",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.017",
    "name": "SVG Smuggling",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1027.018",
    "name": "Invisible Unicode",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1027"
  },
  {
    "id": "T1029",
    "name": "Scheduled Transfer",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1030",
    "name": "Data Transfer Size Limits",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1033",
    "name": "System Owner/User Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1036",
    "name": "Masquerading",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1036.001",
    "name": "Invalid Code Signature",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.002",
    "name": "Right-to-Left Override",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.003",
    "name": "Rename Legitimate Utilities",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.004",
    "name": "Masquerade Task or Service",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.005",
    "name": "Match Legitimate Resource Name or Location",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.006",
    "name": "Space after Filename",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.007",
    "name": "Double File Extension",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.008",
    "name": "Masquerade File Type",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.009",
    "name": "Break Process Trees",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.010",
    "name": "Masquerade Account Name",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.011",
    "name": "Overwrite Process Arguments",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1036.012",
    "name": "Browser Fingerprint",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1036"
  },
  {
    "id": "T1037",
    "name": "Boot or Logon Initialization Scripts",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1037.001",
    "name": "Logon Script (Windows)",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1037"
  },
  {
    "id": "T1037.002",
    "name": "Login Hook",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1037"
  },
  {
    "id": "T1037.003",
    "name": "Network Logon Script",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1037"
  },
  {
    "id": "T1037.004",
    "name": "RC Scripts",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1037"
  },
  {
    "id": "T1037.005",
    "name": "Startup Items",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1037"
  },
  {
    "id": "T1039",
    "name": "Data from Network Shared Drive",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1040",
    "name": "Network Sniffing",
    "tacticIds": [
      "TA0006",
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1041",
    "name": "Exfiltration Over C2 Channel",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1046",
    "name": "Network Service Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1047",
    "name": "Windows Management Instrumentation",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1048",
    "name": "Exfiltration Over Alternative Protocol",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1048.001",
    "name": "Exfiltration Over Symmetric Encrypted Non-C2 Protocol",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1048"
  },
  {
    "id": "T1048.002",
    "name": "Exfiltration Over Asymmetric Encrypted Non-C2 Protocol",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1048"
  },
  {
    "id": "T1048.003",
    "name": "Exfiltration Over Unencrypted Non-C2 Protocol",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1048"
  },
  {
    "id": "T1049",
    "name": "System Network Connections Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1052",
    "name": "Exfiltration Over Physical Medium",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1052.001",
    "name": "Exfiltration over USB",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1052"
  },
  {
    "id": "T1053",
    "name": "Scheduled Task/Job",
    "tacticIds": [
      "TA0002",
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1053.002",
    "name": "At",
    "tacticIds": [
      "TA0002",
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1053"
  },
  {
    "id": "T1053.003",
    "name": "Cron",
    "tacticIds": [
      "TA0002",
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1053"
  },
  {
    "id": "T1053.005",
    "name": "Scheduled Task",
    "tacticIds": [
      "TA0002",
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1053"
  },
  {
    "id": "T1053.006",
    "name": "Systemd Timers",
    "tacticIds": [
      "TA0002",
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1053"
  },
  {
    "id": "T1053.007",
    "name": "Container Orchestration Job",
    "tacticIds": [
      "TA0002",
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1053"
  },
  {
    "id": "T1055",
    "name": "Process Injection",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1055.001",
    "name": "Dynamic-link Library Injection",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.002",
    "name": "Portable Executable Injection",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.003",
    "name": "Thread Execution Hijacking",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.004",
    "name": "Asynchronous Procedure Call",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.005",
    "name": "Thread Local Storage",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.008",
    "name": "Ptrace System Calls",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.009",
    "name": "Proc Memory",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.011",
    "name": "Extra Window Memory Injection",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.012",
    "name": "Process Hollowing",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.013",
    "name": "Process Doppelgänging",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.014",
    "name": "VDSO Hijacking",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1055.015",
    "name": "ListPlanting",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1055"
  },
  {
    "id": "T1056",
    "name": "Input Capture",
    "tacticIds": [
      "TA0009",
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1056.001",
    "name": "Keylogging",
    "tacticIds": [
      "TA0009",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1056"
  },
  {
    "id": "T1056.002",
    "name": "GUI Input Capture",
    "tacticIds": [
      "TA0009",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1056"
  },
  {
    "id": "T1056.003",
    "name": "Web Portal Capture",
    "tacticIds": [
      "TA0009",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1056"
  },
  {
    "id": "T1056.004",
    "name": "Credential API Hooking",
    "tacticIds": [
      "TA0009",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1056"
  },
  {
    "id": "T1057",
    "name": "Process Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1059",
    "name": "Command and Scripting Interpreter",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1059.001",
    "name": "PowerShell",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.002",
    "name": "AppleScript",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.003",
    "name": "Windows Command Shell",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.004",
    "name": "Unix Shell",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.005",
    "name": "Visual Basic",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.006",
    "name": "Python",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.007",
    "name": "JavaScript",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.008",
    "name": "Network Device CLI",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.009",
    "name": "Cloud API",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.010",
    "name": "AutoHotKey & AutoIT",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.011",
    "name": "Lua",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.012",
    "name": "Hypervisor CLI",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1059.013",
    "name": "Container CLI/API",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1059"
  },
  {
    "id": "T1068",
    "name": "Exploitation for Privilege Escalation",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1069",
    "name": "Permission Groups Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1069.001",
    "name": "Local Groups",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1069"
  },
  {
    "id": "T1069.002",
    "name": "Domain Groups",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1069"
  },
  {
    "id": "T1069.003",
    "name": "Cloud Groups",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1069"
  },
  {
    "id": "T1070",
    "name": "Indicator Removal",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1070.003",
    "name": "Clear Command History",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.004",
    "name": "File Deletion",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.005",
    "name": "Network Share Connection Removal",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.006",
    "name": "Timestomp",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.007",
    "name": "Clear Network Connection History and Configurations",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.008",
    "name": "Clear Mailbox Data",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.009",
    "name": "Clear Persistence",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1070.010",
    "name": "Relocate Malware",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1070"
  },
  {
    "id": "T1071",
    "name": "Application Layer Protocol",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1071.001",
    "name": "Web Protocols",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1071"
  },
  {
    "id": "T1071.002",
    "name": "File Transfer Protocols",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1071"
  },
  {
    "id": "T1071.003",
    "name": "Mail Protocols",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1071"
  },
  {
    "id": "T1071.004",
    "name": "DNS",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1071"
  },
  {
    "id": "T1071.005",
    "name": "Publish/Subscribe Protocols",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1071"
  },
  {
    "id": "T1072",
    "name": "Software Deployment Tools",
    "tacticIds": [
      "TA0002",
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1074",
    "name": "Data Staged",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1074.001",
    "name": "Local Data Staging",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1074"
  },
  {
    "id": "T1074.002",
    "name": "Remote Data Staging",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1074"
  },
  {
    "id": "T1078",
    "name": "Valid Accounts",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0004",
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1078.001",
    "name": "Default Accounts",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0004",
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1078"
  },
  {
    "id": "T1078.002",
    "name": "Domain Accounts",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0004",
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1078"
  },
  {
    "id": "T1078.003",
    "name": "Local Accounts",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0004",
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1078"
  },
  {
    "id": "T1078.004",
    "name": "Cloud Accounts",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0004",
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1078"
  },
  {
    "id": "T1080",
    "name": "Taint Shared Content",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1082",
    "name": "System Information Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1083",
    "name": "File and Directory Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1087",
    "name": "Account Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1087.001",
    "name": "Local Account",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1087"
  },
  {
    "id": "T1087.002",
    "name": "Domain Account",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1087"
  },
  {
    "id": "T1087.003",
    "name": "Email Account",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1087"
  },
  {
    "id": "T1087.004",
    "name": "Cloud Account",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1087"
  },
  {
    "id": "T1090",
    "name": "Proxy",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1090.001",
    "name": "Internal Proxy",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1090"
  },
  {
    "id": "T1090.002",
    "name": "External Proxy",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1090"
  },
  {
    "id": "T1090.003",
    "name": "Multi-hop Proxy",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1090"
  },
  {
    "id": "T1090.004",
    "name": "Domain Fronting",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1090"
  },
  {
    "id": "T1091",
    "name": "Replication Through Removable Media",
    "tacticIds": [
      "TA0008",
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1092",
    "name": "Communication Through Removable Media",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1095",
    "name": "Non-Application Layer Protocol",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1098",
    "name": "Account Manipulation",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1098.001",
    "name": "Additional Cloud Credentials",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1098.002",
    "name": "Additional Email Delegate Permissions",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1098.003",
    "name": "Additional Cloud Roles",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1098.004",
    "name": "SSH Authorized Keys",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1098.005",
    "name": "Device Registration",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1098.006",
    "name": "Additional Container Cluster Roles",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1098.007",
    "name": "Additional Local or Domain Groups",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1098"
  },
  {
    "id": "T1102",
    "name": "Web Service",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1102.001",
    "name": "Dead Drop Resolver",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1102"
  },
  {
    "id": "T1102.002",
    "name": "Bidirectional Communication",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1102"
  },
  {
    "id": "T1102.003",
    "name": "One-Way Communication",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1102"
  },
  {
    "id": "T1104",
    "name": "Multi-Stage Channels",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1105",
    "name": "Ingress Tool Transfer",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1106",
    "name": "Native API",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1110",
    "name": "Brute Force",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1110.001",
    "name": "Password Guessing",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1110"
  },
  {
    "id": "T1110.002",
    "name": "Password Cracking",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1110"
  },
  {
    "id": "T1110.003",
    "name": "Password Spraying",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1110"
  },
  {
    "id": "T1110.004",
    "name": "Credential Stuffing",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1110"
  },
  {
    "id": "T1111",
    "name": "Multi-Factor Authentication Interception",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1112",
    "name": "Modify Registry",
    "tacticIds": [
      "TA0112",
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1113",
    "name": "Screen Capture",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1114",
    "name": "Email Collection",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1114.001",
    "name": "Local Email Collection",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1114"
  },
  {
    "id": "T1114.002",
    "name": "Remote Email Collection",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1114"
  },
  {
    "id": "T1114.003",
    "name": "Email Forwarding Rule",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1114"
  },
  {
    "id": "T1115",
    "name": "Clipboard Data",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1119",
    "name": "Automated Collection",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1120",
    "name": "Peripheral Device Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1123",
    "name": "Audio Capture",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1124",
    "name": "System Time Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1125",
    "name": "Video Capture",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1127",
    "name": "Trusted Developer Utilities Proxy Execution",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1127.001",
    "name": "MSBuild",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1127"
  },
  {
    "id": "T1127.002",
    "name": "ClickOnce",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1127"
  },
  {
    "id": "T1127.003",
    "name": "JamPlus",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1127"
  },
  {
    "id": "T1129",
    "name": "Shared Modules",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1132",
    "name": "Data Encoding",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1132.001",
    "name": "Standard Encoding",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1132"
  },
  {
    "id": "T1132.002",
    "name": "Non-Standard Encoding",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1132"
  },
  {
    "id": "T1133",
    "name": "External Remote Services",
    "tacticIds": [
      "TA0003",
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1134",
    "name": "Access Token Manipulation",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1134.001",
    "name": "Token Impersonation/Theft",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1134"
  },
  {
    "id": "T1134.002",
    "name": "Create Process with Token",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1134"
  },
  {
    "id": "T1134.003",
    "name": "Make and Impersonate Token",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1134"
  },
  {
    "id": "T1134.004",
    "name": "Parent PID Spoofing",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1134"
  },
  {
    "id": "T1134.005",
    "name": "SID-History Injection",
    "tacticIds": [
      "TA0005",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1134"
  },
  {
    "id": "T1135",
    "name": "Network Share Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1136",
    "name": "Create Account",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1136.001",
    "name": "Local Account",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1136"
  },
  {
    "id": "T1136.002",
    "name": "Domain Account",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1136"
  },
  {
    "id": "T1136.003",
    "name": "Cloud Account",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1136"
  },
  {
    "id": "T1137",
    "name": "Office Application Startup",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1137.001",
    "name": "Office Template Macros",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1137"
  },
  {
    "id": "T1137.002",
    "name": "Office Test",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1137"
  },
  {
    "id": "T1137.003",
    "name": "Outlook Forms",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1137"
  },
  {
    "id": "T1137.004",
    "name": "Outlook Home Page",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1137"
  },
  {
    "id": "T1137.005",
    "name": "Outlook Rules",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1137"
  },
  {
    "id": "T1137.006",
    "name": "Add-ins",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1137"
  },
  {
    "id": "T1140",
    "name": "Deobfuscate/Decode Files or Information",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1176",
    "name": "Software Extensions",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1176.001",
    "name": "Browser Extensions",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1176"
  },
  {
    "id": "T1176.002",
    "name": "IDE Extensions",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1176"
  },
  {
    "id": "T1185",
    "name": "Browser Session Hijacking",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1187",
    "name": "Forced Authentication",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1189",
    "name": "Drive-by Compromise",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1190",
    "name": "Exploit Public-Facing Application",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1195",
    "name": "Supply Chain Compromise",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1195.001",
    "name": "Compromise Software Dependencies and Development Tools",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1195"
  },
  {
    "id": "T1195.002",
    "name": "Compromise Software Supply Chain",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1195"
  },
  {
    "id": "T1195.003",
    "name": "Compromise Hardware Supply Chain",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1195"
  },
  {
    "id": "T1197",
    "name": "BITS Jobs",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1199",
    "name": "Trusted Relationship",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1200",
    "name": "Hardware Additions",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1201",
    "name": "Password Policy Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1202",
    "name": "Indirect Command Execution",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1203",
    "name": "Exploitation for Client Execution",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1204",
    "name": "User Execution",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1204.001",
    "name": "Malicious Link",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1204"
  },
  {
    "id": "T1204.002",
    "name": "Malicious File",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1204"
  },
  {
    "id": "T1204.003",
    "name": "Malicious Image",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1204"
  },
  {
    "id": "T1204.004",
    "name": "Malicious Copy and Paste",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1204"
  },
  {
    "id": "T1204.005",
    "name": "Malicious Library",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1204"
  },
  {
    "id": "T1205",
    "name": "Traffic Signaling",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1205.001",
    "name": "Port Knocking",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1205"
  },
  {
    "id": "T1205.002",
    "name": "Socket Filters",
    "tacticIds": [
      "TA0005",
      "TA0003",
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1205"
  },
  {
    "id": "T1207",
    "name": "Rogue Domain Controller",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1210",
    "name": "Exploitation of Remote Services",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1211",
    "name": "Exploitation for Stealth",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1212",
    "name": "Exploitation for Credential Access",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1213",
    "name": "Data from Information Repositories",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1213.001",
    "name": "Confluence",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1213"
  },
  {
    "id": "T1213.002",
    "name": "Sharepoint",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1213"
  },
  {
    "id": "T1213.003",
    "name": "Code Repositories",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1213"
  },
  {
    "id": "T1213.004",
    "name": "Customer Relationship Management Software",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1213"
  },
  {
    "id": "T1213.005",
    "name": "Messaging Applications",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1213"
  },
  {
    "id": "T1213.006",
    "name": "Databases",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1213"
  },
  {
    "id": "T1216",
    "name": "System Script Proxy Execution",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1216.001",
    "name": "PubPrn",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1216"
  },
  {
    "id": "T1216.002",
    "name": "SyncAppvPublishingServer",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1216"
  },
  {
    "id": "T1217",
    "name": "Browser Information Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1218",
    "name": "System Binary Proxy Execution",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1218.001",
    "name": "Compiled HTML File",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.002",
    "name": "Control Panel",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.003",
    "name": "CMSTP",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.004",
    "name": "InstallUtil",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.005",
    "name": "Mshta",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.007",
    "name": "Msiexec",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.008",
    "name": "Odbcconf",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.009",
    "name": "Regsvcs/Regasm",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.010",
    "name": "Regsvr32",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.011",
    "name": "Rundll32",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.012",
    "name": "Verclsid",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.013",
    "name": "Mavinject",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.014",
    "name": "MMC",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1218.015",
    "name": "Electron Applications",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1218"
  },
  {
    "id": "T1219",
    "name": "Remote Access Tools",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1219.001",
    "name": "IDE Tunneling",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1219"
  },
  {
    "id": "T1219.002",
    "name": "Remote Desktop Software",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1219"
  },
  {
    "id": "T1219.003",
    "name": "Remote Access Hardware",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1219"
  },
  {
    "id": "T1220",
    "name": "XSL Script Processing",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1221",
    "name": "Template Injection",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1222",
    "name": "File and Directory Permissions Modification",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1222.001",
    "name": "Windows Permissions",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1222"
  },
  {
    "id": "T1222.002",
    "name": "Linux and Mac Permissions",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1222"
  },
  {
    "id": "T1480",
    "name": "Execution Guardrails",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1480.001",
    "name": "Environmental Keying",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1480"
  },
  {
    "id": "T1480.002",
    "name": "Mutual Exclusion",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1480"
  },
  {
    "id": "T1482",
    "name": "Domain Trust Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1484",
    "name": "Domain or Tenant Policy Modification",
    "tacticIds": [
      "TA0112",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1484.001",
    "name": "Group Policy Modification",
    "tacticIds": [
      "TA0112",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1484"
  },
  {
    "id": "T1484.002",
    "name": "Trust Modification",
    "tacticIds": [
      "TA0112",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1484"
  },
  {
    "id": "T1485",
    "name": "Data Destruction",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1485.001",
    "name": "Lifecycle-Triggered Deletion",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1485"
  },
  {
    "id": "T1486",
    "name": "Data Encrypted for Impact",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1489",
    "name": "Service Stop",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1490",
    "name": "Inhibit System Recovery",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1491",
    "name": "Defacement",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1491.001",
    "name": "Internal Defacement",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1491"
  },
  {
    "id": "T1491.002",
    "name": "External Defacement",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1491"
  },
  {
    "id": "T1495",
    "name": "Firmware Corruption",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1496",
    "name": "Resource Hijacking",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1496.001",
    "name": "Compute Hijacking",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1496"
  },
  {
    "id": "T1496.002",
    "name": "Bandwidth Hijacking",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1496"
  },
  {
    "id": "T1496.003",
    "name": "SMS Pumping",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1496"
  },
  {
    "id": "T1496.004",
    "name": "Cloud Service Hijacking",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1496"
  },
  {
    "id": "T1497",
    "name": "Virtualization/Sandbox Evasion",
    "tacticIds": [
      "TA0005",
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1497.001",
    "name": "System Checks",
    "tacticIds": [
      "TA0005",
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1497"
  },
  {
    "id": "T1497.002",
    "name": "User Activity Based Checks",
    "tacticIds": [
      "TA0005",
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1497"
  },
  {
    "id": "T1497.003",
    "name": "Time Based Checks",
    "tacticIds": [
      "TA0005",
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1497"
  },
  {
    "id": "T1498",
    "name": "Network Denial of Service",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1498.001",
    "name": "Direct Network Flood",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1498"
  },
  {
    "id": "T1498.002",
    "name": "Reflection Amplification",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1498"
  },
  {
    "id": "T1499",
    "name": "Endpoint Denial of Service",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1499.001",
    "name": "OS Exhaustion Flood",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1499"
  },
  {
    "id": "T1499.002",
    "name": "Service Exhaustion Flood",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1499"
  },
  {
    "id": "T1499.003",
    "name": "Application Exhaustion Flood",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1499"
  },
  {
    "id": "T1499.004",
    "name": "Application or System Exploitation",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1499"
  },
  {
    "id": "T1505",
    "name": "Server Software Component",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1505.001",
    "name": "SQL Stored Procedures",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1505"
  },
  {
    "id": "T1505.002",
    "name": "Transport Agent",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1505"
  },
  {
    "id": "T1505.003",
    "name": "Web Shell",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1505"
  },
  {
    "id": "T1505.004",
    "name": "IIS Components",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1505"
  },
  {
    "id": "T1505.005",
    "name": "Terminal Services DLL",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1505"
  },
  {
    "id": "T1505.006",
    "name": "vSphere Installation Bundles",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1505"
  },
  {
    "id": "T1518",
    "name": "Software Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1518.001",
    "name": "Security Software Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1518"
  },
  {
    "id": "T1518.002",
    "name": "Backup Software Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1518"
  },
  {
    "id": "T1525",
    "name": "Implant Internal Image",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1526",
    "name": "Cloud Service Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1528",
    "name": "Steal Application Access Token",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1529",
    "name": "System Shutdown/Reboot",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1530",
    "name": "Data from Cloud Storage",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1531",
    "name": "Account Access Removal",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1534",
    "name": "Internal Spearphishing",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1535",
    "name": "Unused/Unsupported Cloud Regions",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1537",
    "name": "Transfer Data to Cloud Account",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1538",
    "name": "Cloud Service Dashboard",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1539",
    "name": "Steal Web Session Cookie",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1542",
    "name": "Pre-OS Boot",
    "tacticIds": [
      "TA0005",
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1542.001",
    "name": "System Firmware",
    "tacticIds": [
      "TA0005",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1542"
  },
  {
    "id": "T1542.002",
    "name": "Component Firmware",
    "tacticIds": [
      "TA0005",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1542"
  },
  {
    "id": "T1542.003",
    "name": "Bootkit",
    "tacticIds": [
      "TA0005",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1542"
  },
  {
    "id": "T1542.004",
    "name": "ROMMONkit",
    "tacticIds": [
      "TA0005",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1542"
  },
  {
    "id": "T1542.005",
    "name": "TFTP Boot",
    "tacticIds": [
      "TA0005",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1542"
  },
  {
    "id": "T1543",
    "name": "Create or Modify System Process",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1543.001",
    "name": "Launch Agent",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1543"
  },
  {
    "id": "T1543.002",
    "name": "Systemd Service",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1543"
  },
  {
    "id": "T1543.003",
    "name": "Windows Service",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1543"
  },
  {
    "id": "T1543.004",
    "name": "Launch Daemon",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1543"
  },
  {
    "id": "T1543.005",
    "name": "Container Service",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1543"
  },
  {
    "id": "T1546",
    "name": "Event Triggered Execution",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1546.001",
    "name": "Change Default File Association",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.002",
    "name": "Screensaver",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.003",
    "name": "Windows Management Instrumentation Event Subscription",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.004",
    "name": "Unix Shell Configuration Modification",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.005",
    "name": "Trap",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.006",
    "name": "LC_LOAD_DYLIB Addition",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.007",
    "name": "Netsh Helper DLL",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.008",
    "name": "Accessibility Features",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.009",
    "name": "AppCert DLLs",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.010",
    "name": "AppInit DLLs",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.011",
    "name": "Application Shimming",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.012",
    "name": "Image File Execution Options Injection",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.013",
    "name": "PowerShell Profile",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.014",
    "name": "Emond",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.015",
    "name": "Component Object Model Hijacking",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.016",
    "name": "Installer Packages",
    "tacticIds": [
      "TA0004",
      "TA0003"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.017",
    "name": "Udev Rules",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1546.018",
    "name": "Python Startup Hooks",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1546"
  },
  {
    "id": "T1547",
    "name": "Boot or Logon Autostart Execution",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1547.001",
    "name": "Registry Run Keys / Startup Folder",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.002",
    "name": "Authentication Package",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.003",
    "name": "Time Providers",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.004",
    "name": "Winlogon Helper DLL",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.005",
    "name": "Security Support Provider",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.006",
    "name": "Kernel Modules and Extensions",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.007",
    "name": "Re-opened Applications",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.008",
    "name": "LSASS Driver",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.009",
    "name": "Shortcut Modification",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.010",
    "name": "Port Monitors",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.012",
    "name": "Print Processors",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.013",
    "name": "XDG Autostart Entries",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.014",
    "name": "Active Setup",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1547.015",
    "name": "Login Items",
    "tacticIds": [
      "TA0003",
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1547"
  },
  {
    "id": "T1548",
    "name": "Abuse Elevation Control Mechanism",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1548.001",
    "name": "Setuid and Setgid",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1548"
  },
  {
    "id": "T1548.002",
    "name": "Bypass User Account Control",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1548"
  },
  {
    "id": "T1548.003",
    "name": "Sudo and Sudo Caching",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1548"
  },
  {
    "id": "T1548.004",
    "name": "Elevated Execution with Prompt",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1548"
  },
  {
    "id": "T1548.005",
    "name": "Temporary Elevated Cloud Access",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1548"
  },
  {
    "id": "T1548.006",
    "name": "TCC Manipulation",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": true,
    "parentId": "T1548"
  },
  {
    "id": "T1550",
    "name": "Use Alternate Authentication Material",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1550.001",
    "name": "Application Access Token",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1550"
  },
  {
    "id": "T1550.002",
    "name": "Pass the Hash",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1550"
  },
  {
    "id": "T1550.003",
    "name": "Pass the Ticket",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1550"
  },
  {
    "id": "T1550.004",
    "name": "Web Session Cookie",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1550"
  },
  {
    "id": "T1552",
    "name": "Unsecured Credentials",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1552.001",
    "name": "Credentials In Files",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.002",
    "name": "Credentials in Registry",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.003",
    "name": "Shell History",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.004",
    "name": "Private Keys",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.005",
    "name": "Cloud Instance Metadata API",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.006",
    "name": "Group Policy Preferences",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.007",
    "name": "Container API",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1552.008",
    "name": "Chat Messages",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1552"
  },
  {
    "id": "T1553",
    "name": "Subvert Trust Controls",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1553.001",
    "name": "Gatekeeper Bypass",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1553"
  },
  {
    "id": "T1553.002",
    "name": "Code Signing",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1553"
  },
  {
    "id": "T1553.003",
    "name": "SIP and Trust Provider Hijacking",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1553"
  },
  {
    "id": "T1553.004",
    "name": "Install Root Certificate",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1553"
  },
  {
    "id": "T1553.005",
    "name": "Mark-of-the-Web Bypass",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1553"
  },
  {
    "id": "T1553.006",
    "name": "Code Signing Policy Modification",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1553"
  },
  {
    "id": "T1554",
    "name": "Compromise Host Software Binary",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1555",
    "name": "Credentials from Password Stores",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1555.001",
    "name": "Keychain",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1555"
  },
  {
    "id": "T1555.002",
    "name": "Securityd Memory",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1555"
  },
  {
    "id": "T1555.003",
    "name": "Credentials from Web Browsers",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1555"
  },
  {
    "id": "T1555.004",
    "name": "Windows Credential Manager",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1555"
  },
  {
    "id": "T1555.005",
    "name": "Password Managers",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1555"
  },
  {
    "id": "T1555.006",
    "name": "Cloud Secrets Management Stores",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1555"
  },
  {
    "id": "T1556",
    "name": "Modify Authentication Process",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1556.001",
    "name": "Domain Controller Authentication",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.002",
    "name": "Password Filter DLL",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.003",
    "name": "Pluggable Authentication Modules",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.004",
    "name": "Network Device Authentication",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.005",
    "name": "Reversible Encryption",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.006",
    "name": "Multi-Factor Authentication",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.007",
    "name": "Hybrid Identity",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.008",
    "name": "Network Provider DLL",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1556.009",
    "name": "Conditional Access Policies",
    "tacticIds": [
      "TA0112",
      "TA0003",
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1556"
  },
  {
    "id": "T1557",
    "name": "Adversary-in-the-Middle",
    "tacticIds": [
      "TA0006",
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1557.001",
    "name": "Name Resolution Poisoning and SMB Relay",
    "tacticIds": [
      "TA0006",
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1557"
  },
  {
    "id": "T1557.002",
    "name": "ARP Cache Poisoning",
    "tacticIds": [
      "TA0006",
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1557"
  },
  {
    "id": "T1557.003",
    "name": "DHCP Spoofing",
    "tacticIds": [
      "TA0006",
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1557"
  },
  {
    "id": "T1557.004",
    "name": "Evil Twin",
    "tacticIds": [
      "TA0006",
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1557"
  },
  {
    "id": "T1558",
    "name": "Steal or Forge Kerberos Tickets",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1558.001",
    "name": "Golden Ticket",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1558"
  },
  {
    "id": "T1558.002",
    "name": "Silver Ticket",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1558"
  },
  {
    "id": "T1558.003",
    "name": "Kerberoasting",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1558"
  },
  {
    "id": "T1558.004",
    "name": "AS-REP Roasting",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1558"
  },
  {
    "id": "T1558.005",
    "name": "Ccache Files",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1558"
  },
  {
    "id": "T1559",
    "name": "Inter-Process Communication",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1559.001",
    "name": "Component Object Model",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1559"
  },
  {
    "id": "T1559.002",
    "name": "Dynamic Data Exchange",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1559"
  },
  {
    "id": "T1559.003",
    "name": "XPC Services",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1559"
  },
  {
    "id": "T1560",
    "name": "Archive Collected Data",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1560.001",
    "name": "Archive via Utility",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1560"
  },
  {
    "id": "T1560.002",
    "name": "Archive via Library",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1560"
  },
  {
    "id": "T1560.003",
    "name": "Archive via Custom Method",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1560"
  },
  {
    "id": "T1561",
    "name": "Disk Wipe",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1561.001",
    "name": "Disk Content Wipe",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1561"
  },
  {
    "id": "T1561.002",
    "name": "Disk Structure Wipe",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1561"
  },
  {
    "id": "T1563",
    "name": "Remote Service Session Hijacking",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1563.001",
    "name": "SSH Hijacking",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1563"
  },
  {
    "id": "T1563.002",
    "name": "RDP Hijacking",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": true,
    "parentId": "T1563"
  },
  {
    "id": "T1564",
    "name": "Hide Artifacts",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1564.001",
    "name": "Hidden Files and Directories",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.002",
    "name": "Hidden Users",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.003",
    "name": "Hidden Window",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.004",
    "name": "NTFS File Attributes",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.005",
    "name": "Hidden File System",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.006",
    "name": "Run Virtual Instance",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.007",
    "name": "VBA Stomping",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.008",
    "name": "Email Hiding Rules",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.009",
    "name": "Resource Forking",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.010",
    "name": "Process Argument Spoofing",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.011",
    "name": "Ignore Process Interrupts",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.012",
    "name": "File/Path Exclusions",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.013",
    "name": "Bind Mounts",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1564.014",
    "name": "Extended Attributes",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1564"
  },
  {
    "id": "T1565",
    "name": "Data Manipulation",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1565.001",
    "name": "Stored Data Manipulation",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1565"
  },
  {
    "id": "T1565.002",
    "name": "Transmitted Data Manipulation",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1565"
  },
  {
    "id": "T1565.003",
    "name": "Runtime Data Manipulation",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": true,
    "parentId": "T1565"
  },
  {
    "id": "T1566",
    "name": "Phishing",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1566.001",
    "name": "Spearphishing Attachment",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1566"
  },
  {
    "id": "T1566.002",
    "name": "Spearphishing Link",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1566"
  },
  {
    "id": "T1566.003",
    "name": "Spearphishing via Service",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1566"
  },
  {
    "id": "T1566.004",
    "name": "Spearphishing Voice",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": true,
    "parentId": "T1566"
  },
  {
    "id": "T1567",
    "name": "Exfiltration Over Web Service",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1567.001",
    "name": "Exfiltration to Code Repository",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1567"
  },
  {
    "id": "T1567.002",
    "name": "Exfiltration to Cloud Storage",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1567"
  },
  {
    "id": "T1567.003",
    "name": "Exfiltration to Text Storage Sites",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1567"
  },
  {
    "id": "T1567.004",
    "name": "Exfiltration Over Webhook",
    "tacticIds": [
      "TA0010"
    ],
    "isSubTechnique": true,
    "parentId": "T1567"
  },
  {
    "id": "T1568",
    "name": "Dynamic Resolution",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1568.001",
    "name": "Fast Flux DNS",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1568"
  },
  {
    "id": "T1568.002",
    "name": "Domain Generation Algorithms",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1568"
  },
  {
    "id": "T1568.003",
    "name": "DNS Calculation",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1568"
  },
  {
    "id": "T1569",
    "name": "System Services",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1569.001",
    "name": "Launchctl",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1569"
  },
  {
    "id": "T1569.002",
    "name": "Service Execution",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1569"
  },
  {
    "id": "T1569.003",
    "name": "Systemctl",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1569"
  },
  {
    "id": "T1570",
    "name": "Lateral Tool Transfer",
    "tacticIds": [
      "TA0008"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1571",
    "name": "Non-Standard Port",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1572",
    "name": "Protocol Tunneling",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1573",
    "name": "Encrypted Channel",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1573.001",
    "name": "Symmetric Cryptography",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1573"
  },
  {
    "id": "T1573.002",
    "name": "Asymmetric Cryptography",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": true,
    "parentId": "T1573"
  },
  {
    "id": "T1574",
    "name": "Hijack Execution Flow",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1574.001",
    "name": "DLL",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.004",
    "name": "Dylib Hijacking",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.005",
    "name": "Executable Installer File Permissions Weakness",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.006",
    "name": "Dynamic Linker Hijacking",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.007",
    "name": "Path Interception by PATH Environment Variable",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.008",
    "name": "Path Interception by Search Order Hijacking",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.009",
    "name": "Path Interception by Unquoted Path",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.010",
    "name": "Services File Permissions Weakness",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.011",
    "name": "Services Registry Permissions Weakness",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.012",
    "name": "COR_PROFILER",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.013",
    "name": "KernelCallbackTable",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1574.014",
    "name": "AppDomainManager",
    "tacticIds": [
      "TA0005",
      "TA0002"
    ],
    "isSubTechnique": true,
    "parentId": "T1574"
  },
  {
    "id": "T1578",
    "name": "Modify Cloud Compute Infrastructure",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1578.001",
    "name": "Create Snapshot",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1578"
  },
  {
    "id": "T1578.002",
    "name": "Create Cloud Instance",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1578"
  },
  {
    "id": "T1578.003",
    "name": "Delete Cloud Instance",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1578"
  },
  {
    "id": "T1578.004",
    "name": "Revert Cloud Instance",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1578"
  },
  {
    "id": "T1578.005",
    "name": "Modify Cloud Compute Configurations",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1578"
  },
  {
    "id": "T1580",
    "name": "Cloud Infrastructure Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1583",
    "name": "Acquire Infrastructure",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1583.001",
    "name": "Domains",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.002",
    "name": "DNS Server",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.003",
    "name": "Virtual Private Server",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.004",
    "name": "Server",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.005",
    "name": "Botnet",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.006",
    "name": "Web Services",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.007",
    "name": "Serverless",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1583.008",
    "name": "Malvertising",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1583"
  },
  {
    "id": "T1584",
    "name": "Compromise Infrastructure",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1584.001",
    "name": "Domains",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.002",
    "name": "DNS Server",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.003",
    "name": "Virtual Private Server",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.004",
    "name": "Server",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.005",
    "name": "Botnet",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.006",
    "name": "Web Services",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.007",
    "name": "Serverless",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1584.008",
    "name": "Network Devices",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1584"
  },
  {
    "id": "T1585",
    "name": "Establish Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1585.001",
    "name": "Social Media Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1585"
  },
  {
    "id": "T1585.002",
    "name": "Email Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1585"
  },
  {
    "id": "T1585.003",
    "name": "Cloud Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1585"
  },
  {
    "id": "T1586",
    "name": "Compromise Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1586.001",
    "name": "Social Media Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1586"
  },
  {
    "id": "T1586.002",
    "name": "Email Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1586"
  },
  {
    "id": "T1586.003",
    "name": "Cloud Accounts",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1586"
  },
  {
    "id": "T1587",
    "name": "Develop Capabilities",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1587.001",
    "name": "Malware",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1587"
  },
  {
    "id": "T1587.002",
    "name": "Code Signing Certificates",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1587"
  },
  {
    "id": "T1587.003",
    "name": "Digital Certificates",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1587"
  },
  {
    "id": "T1587.004",
    "name": "Exploits",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1587"
  },
  {
    "id": "T1588",
    "name": "Obtain Capabilities",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1588.001",
    "name": "Malware",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1588.002",
    "name": "Tool",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1588.003",
    "name": "Code Signing Certificates",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1588.004",
    "name": "Digital Certificates",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1588.005",
    "name": "Exploits",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1588.006",
    "name": "Vulnerabilities",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1588.007",
    "name": "Artificial Intelligence",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1588"
  },
  {
    "id": "T1589",
    "name": "Gather Victim Identity Information",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1589.001",
    "name": "Credentials",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1589"
  },
  {
    "id": "T1589.002",
    "name": "Email Addresses",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1589"
  },
  {
    "id": "T1589.003",
    "name": "Employee Names",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1589"
  },
  {
    "id": "T1590",
    "name": "Gather Victim Network Information",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1590.001",
    "name": "Domain Properties",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1590"
  },
  {
    "id": "T1590.002",
    "name": "DNS",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1590"
  },
  {
    "id": "T1590.003",
    "name": "Network Trust Dependencies",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1590"
  },
  {
    "id": "T1590.004",
    "name": "Network Topology",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1590"
  },
  {
    "id": "T1590.005",
    "name": "IP Addresses",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1590"
  },
  {
    "id": "T1590.006",
    "name": "Network Security Appliances",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1590"
  },
  {
    "id": "T1591",
    "name": "Gather Victim Org Information",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1591.001",
    "name": "Determine Physical Locations",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1591"
  },
  {
    "id": "T1591.002",
    "name": "Business Relationships",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1591"
  },
  {
    "id": "T1591.003",
    "name": "Identify Business Tempo",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1591"
  },
  {
    "id": "T1591.004",
    "name": "Identify Roles",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1591"
  },
  {
    "id": "T1592",
    "name": "Gather Victim Host Information",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1592.001",
    "name": "Hardware",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1592"
  },
  {
    "id": "T1592.002",
    "name": "Software",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1592"
  },
  {
    "id": "T1592.003",
    "name": "Firmware",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1592"
  },
  {
    "id": "T1592.004",
    "name": "Client Configurations",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1592"
  },
  {
    "id": "T1593",
    "name": "Search Open Websites/Domains",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1593.001",
    "name": "Social Media",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1593"
  },
  {
    "id": "T1593.002",
    "name": "Search Engines",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1593"
  },
  {
    "id": "T1593.003",
    "name": "Code Repositories",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1593"
  },
  {
    "id": "T1594",
    "name": "Search Victim-Owned Websites",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1595",
    "name": "Active Scanning",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1595.001",
    "name": "Scanning IP Blocks",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1595"
  },
  {
    "id": "T1595.002",
    "name": "Vulnerability Scanning",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1595"
  },
  {
    "id": "T1595.003",
    "name": "Wordlist Scanning",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1595"
  },
  {
    "id": "T1596",
    "name": "Search Open Technical Databases",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1596.001",
    "name": "DNS/Passive DNS",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1596"
  },
  {
    "id": "T1596.002",
    "name": "WHOIS",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1596"
  },
  {
    "id": "T1596.003",
    "name": "Digital Certificates",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1596"
  },
  {
    "id": "T1596.004",
    "name": "CDNs",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1596"
  },
  {
    "id": "T1596.005",
    "name": "Scan Databases",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1596"
  },
  {
    "id": "T1597",
    "name": "Search Closed Sources",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1597.001",
    "name": "Threat Intel Vendors",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1597"
  },
  {
    "id": "T1597.002",
    "name": "Purchase Technical Data",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1597"
  },
  {
    "id": "T1598",
    "name": "Phishing for Information",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1598.001",
    "name": "Spearphishing Service",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1598"
  },
  {
    "id": "T1598.002",
    "name": "Spearphishing Attachment",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1598"
  },
  {
    "id": "T1598.003",
    "name": "Spearphishing Link",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1598"
  },
  {
    "id": "T1598.004",
    "name": "Spearphishing Voice",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": true,
    "parentId": "T1598"
  },
  {
    "id": "T1599",
    "name": "Network Boundary Bridging",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1599.001",
    "name": "Network Address Translation Traversal",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1599"
  },
  {
    "id": "T1600",
    "name": "Weaken Encryption",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1600.001",
    "name": "Reduce Key Space",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1600"
  },
  {
    "id": "T1600.002",
    "name": "Disable Crypto Hardware",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1600"
  },
  {
    "id": "T1601",
    "name": "Modify System Image",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1601.001",
    "name": "Patch System Image",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1601"
  },
  {
    "id": "T1601.002",
    "name": "Downgrade System Image",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1601"
  },
  {
    "id": "T1602",
    "name": "Data from Configuration Repository",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1602.001",
    "name": "SNMP (MIB Dump)",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1602"
  },
  {
    "id": "T1602.002",
    "name": "Network Device Configuration Dump",
    "tacticIds": [
      "TA0009"
    ],
    "isSubTechnique": true,
    "parentId": "T1602"
  },
  {
    "id": "T1606",
    "name": "Forge Web Credentials",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1606.001",
    "name": "Web Cookies",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1606"
  },
  {
    "id": "T1606.002",
    "name": "SAML Tokens",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": true,
    "parentId": "T1606"
  },
  {
    "id": "T1608",
    "name": "Stage Capabilities",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1608.001",
    "name": "Upload Malware",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1608"
  },
  {
    "id": "T1608.002",
    "name": "Upload Tool",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1608"
  },
  {
    "id": "T1608.003",
    "name": "Install Digital Certificate",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1608"
  },
  {
    "id": "T1608.004",
    "name": "Drive-by Target",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1608"
  },
  {
    "id": "T1608.005",
    "name": "Link Target",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1608"
  },
  {
    "id": "T1608.006",
    "name": "SEO Poisoning",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1608"
  },
  {
    "id": "T1609",
    "name": "Container Administration Command",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1610",
    "name": "Deploy Container",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1611",
    "name": "Escape to Host",
    "tacticIds": [
      "TA0004"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1612",
    "name": "Build Image on Host",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1613",
    "name": "Container and Resource Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1614",
    "name": "System Location Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1614.001",
    "name": "System Language Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": true,
    "parentId": "T1614"
  },
  {
    "id": "T1615",
    "name": "Group Policy Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1619",
    "name": "Cloud Storage Object Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1620",
    "name": "Reflective Code Loading",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1621",
    "name": "Multi-Factor Authentication Request Generation",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1622",
    "name": "Debugger Evasion",
    "tacticIds": [
      "TA0005",
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1647",
    "name": "Plist File Modification",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1648",
    "name": "Serverless Execution",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1649",
    "name": "Steal or Forge Authentication Certificates",
    "tacticIds": [
      "TA0006"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1650",
    "name": "Acquire Access",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1651",
    "name": "Cloud Administration Command",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1652",
    "name": "Device Driver Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1653",
    "name": "Power Settings",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1654",
    "name": "Log Enumeration",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1657",
    "name": "Financial Theft",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1659",
    "name": "Content Injection",
    "tacticIds": [
      "TA0001",
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1665",
    "name": "Hide Infrastructure",
    "tacticIds": [
      "TA0011"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1666",
    "name": "Modify Cloud Resource Hierarchy",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1667",
    "name": "Email Bombing",
    "tacticIds": [
      "TA0040"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1668",
    "name": "Exclusive Control",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1669",
    "name": "Wi-Fi Networks",
    "tacticIds": [
      "TA0001"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1671",
    "name": "Cloud Application Integration",
    "tacticIds": [
      "TA0003"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1673",
    "name": "Virtual Machine Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1674",
    "name": "Input Injection",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1675",
    "name": "ESXi Administration Command",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1677",
    "name": "Poisoned Pipeline Execution",
    "tacticIds": [
      "TA0002"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1678",
    "name": "Delay Execution",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1679",
    "name": "Selective Exclusion",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1680",
    "name": "Local Storage Discovery",
    "tacticIds": [
      "TA0007"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1681",
    "name": "Search Threat Vendor Data",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1682",
    "name": "Query Public AI Services",
    "tacticIds": [
      "TA0043"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1683",
    "name": "Generate Content",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1683.001",
    "name": "Written Content",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1683"
  },
  {
    "id": "T1683.002",
    "name": "Audio-Visual Content",
    "tacticIds": [
      "TA0042"
    ],
    "isSubTechnique": true,
    "parentId": "T1683"
  },
  {
    "id": "T1684",
    "name": "Social Engineering",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1684.001",
    "name": "Impersonation",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1684"
  },
  {
    "id": "T1684.002",
    "name": "Email Spoofing",
    "tacticIds": [
      "TA0005"
    ],
    "isSubTechnique": true,
    "parentId": "T1684"
  },
  {
    "id": "T1685",
    "name": "Disable or Modify Tools",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1685.001",
    "name": "Disable or Modify Windows Event Log",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1685"
  },
  {
    "id": "T1685.002",
    "name": "Disable or Modify Cloud Log",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1685"
  },
  {
    "id": "T1685.003",
    "name": "Modify or Spoof Tool UI",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1685"
  },
  {
    "id": "T1685.004",
    "name": "Disable or Modify Linux Audit System Log",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1685"
  },
  {
    "id": "T1685.005",
    "name": "Clear Windows Event Logs",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1685"
  },
  {
    "id": "T1685.006",
    "name": "Clear Linux or Mac System Logs",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1685"
  },
  {
    "id": "T1686",
    "name": "Disable or Modify System Firewall",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1686.001",
    "name": "Cloud Firewall",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1686"
  },
  {
    "id": "T1686.002",
    "name": "Network Device Firewall",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1686"
  },
  {
    "id": "T1686.003",
    "name": "Windows Host Firewall",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": true,
    "parentId": "T1686"
  },
  {
    "id": "T1687",
    "name": "Exploitation for Defense Impairment",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1688",
    "name": "Safe Mode Boot",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1689",
    "name": "Downgrade Attack",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  },
  {
    "id": "T1690",
    "name": "Prevent Command History Logging",
    "tacticIds": [
      "TA0112"
    ],
    "isSubTechnique": false
  }
];
