-----

Table: Project

- projectId 
  (type: int, increment [XXXXXX])
- ag06Link 
  (type: URL)
- docId 
  // maps to Document.docId [1 to 1]
- workType 
  (type string, enum ["Intial Draft", "Revision", "Amendment", "Withdraw"])

- projApproved 
  (type: boolean) 
  // TC approved
- projApprovedDate
  (type: date)

- assignedGroup
  // maps to Group.groupId [1 to 1]
- assignedTC 
  // maps to Group.groupId [1 to 1]

- projChair
  // maps to Members.GUID [1 to 1]
- projDocEd
  // maps to Members.GUID [1 to 1]
- projSecretary
  // maps to Members.GUID [1 to 1]
- projProponent(s)
  // maps to Members.GUID [1 to many]

- projScope
  (type: string) 
- projdateStart
  (type: date)
- projdateDue 
  (type: date)
- projDesc
  (type: string) 
- projProblem
  (type: string) 
- projTasks
  (type: string) 
- projPcd
  (type: boolean)
- projType
  (type: string, enum ["WG", "DG", "SG", "TF", "Individual"]) 
- projliaisonsExt
  (type: string, enum ["AES", "ATSC", "CEA", "EBU", "IEC TC100", "ISO TC36", "ITU-R", "ITU-T", "JTC1/SC29/WG1", "JTC1/SC29/WG11"])
- projliaisonSMPTE
  (type: string, enum ["10E", "20F", "21DC", "24TB", "30MR", "31FS", "32NF", "34CS", "35PM"])
- projliaisonOther
  (type: string)

- docAffected
  (type: array [docId(s)])
  // this only applies to published documents that have new projects, for flagging and tracking upcoming new revisions, amendments, etc (i.e. ST 429-2:2019 would have a link to project for the work done as ST 429-2:2020)

- projectState
  (type: string) //enumed from lists

// Table: Project-Milestone
- milestoneId
  // Milestone ID
- projectId 
  // maps to Project.projectId [many to 1]
- draftID 
  // maps to DraftDocument.draftId [1 to 1], used for ballot packages for example
- milestoneAct 
  (type: string, enum [ 1=ST/RP/ED 2=RDD 3=ER
    "Awaiting ST Objection Disposition Vote (5%)", 123
    "Waiting for Group Assignment (15%)", 123
    "WG/DG working on WD (20%)" 123
    "WD (22.5%)", 123
    "CD (25%)", 1
    "Pre-FCD Review (30%)", 13
    "Pre-RDD Review (30%)", 2
    "CD Waiting for FCD Ballot (40%)", 1
    "CD Waiting for RDD Ballot (40%)", 2
    "CD Waiting for Submission to SVP (40%)", 3
    "PCD (45%)", 12
    "FCD Ballot (50%)", 1
    "RDD Ballot (50%)", 2
    "FCD Ballot Comment Resolution (60%)", 1
    "RDD Ballot Comment Resolution (60%)", 2
    "FCD (65%)", 1
    "Pre-DP Review (70%)", 1
    "RDD (75%)" 2
    "DP Ballot (80%)", 1
    "SVP Review", 3
    "DP (85%)", 1
    "ST Audit (90%)", 12
    "Document in HQ (95%)", 123
    "Published (100%)", 123
    "Uploaded to TC Ref Docs", 123
    "Archive" 123
    ])
- miledateStart
  (type: date)
- miledateEnd
  (type: date)
  
-----

// Table: Document
- docId 
  (type: string, unique [simplified docLabel, lowercase, no space, misc characters subbed with dashes (i.e. "st430-17-20XX") ])
- docLabel
  (type: string [document number formatted as "ST 430-17:20XX"])
  - calc'd as: abbre. docType + " " + docNumber + "-" + docPart + docElement + ":" + publicationDateYear
- docTitle 
  (type: string [i.e. "21DC SMS OMB Comm. Protocol])
- docType
  (type: string, enum ["Standard", "Recommended Practice", "Engineering Guideline", "Registered Disclosure Document", "Advisory Note". "Administrative Guideline", "Engineering Report", "Overview Document"])
- docElement
  (type: string) 
- docNumber
  (type: int) 
- docPart
  (type: int)
- publisher
  (type: string, enum ["SMPTE"])
- href 
  (type: URL)
- publicationDate 
  (type: string) 
  // to be updated to date type later
  - calc'd as: publicationDateYear + "-" + publicationDateMonth + "-01T07:00:00.000Z"
- publicationDateYear
  (type: int) 
- publicationDateMonth
  (type: int)
- publicationDateDay
  (type: int)
- repo
  (type: URL)
- status/statusNote 
  (type: string)
- status/draft 
  (type: boolean)
- status/active 
  (type: boolean)
- status/amended 
  (type: boolean)
- status/reaffirmed 
  (type: boolean)
- status/reaffirmedDate 
  (type: string)
- status/stabilized 
  (type: boolean)
- status/stabilizedDate 
  (type: string)
- status/superseded 
  (type: boolean) 
- status/withdrawn 
  (type: boolean) 
- status/withdrawnDate 
  (type: string)
- status/pcd
  (type: boolean) 

// Table: Document-Amendment
- amendId
 // Amendment ID
- docID
  // maps to Document.docId [many to 1]
- amendedBy 
  (type: string [docId])

// Table: Document-Version
- versionID 
  (type: string, unique [docId + versionNum i.e. "st430-17-20XX-versionNum")
- docId
  // maps to Document.docId [many to 1]
- versionNum
  (type: int, increment [XXXXXX])
- versionHref
  (type: URL)

// Table: Document-Element
- elementId
 // Element ID
- docID
  // maps to Document.docId [many to 1]
- elementType 
  (type: string, enum ["XSD", "image". "XML"]) 
  // add what you need
- elementPurpose 
  (type: string, enum ["in pub package", "archive")
  // edit/add what you need here
- elementAsset 
  (type: URL)

// Table: Document-Keyword
- keyId
 // Keyword ID
- docID
  // maps to Document.docId [many to 1]
- keyWord 
  (type: string)

// Table: Document-Reference
- refId
  // Reference ID
- docID 
  // maps to Document.docId [many to 1]
- refType
  (type: string, enum ["Normative", "Bibliographic"])
- refDocId
  (type: string [docId]) 
  // docId of document referenced

// Table: Review
- reviewId 
  // Review ID
- docID 
  // maps to Document.docId [many to 1]
- assignedGroup
  // maps to Group.groupId [1 to 1]
- reviewNeeded
  (type: boolean)
- reviewPeriod
  (type: string, enum ["1 Year", "5 Year"]) 
- reviewDate
  (type: string)
- reviewRec
  (type: string, enum ["Reaffirm", "Stabilize", "Revise", "Withdraw", "Reassign", "No Recommendation"])
- recApproved
  (type: boolean)
  // TC Approved
- reviewNotes
  (type: array [string(s)])

// Table: Document-Superseded
- superId
 // Superseded ID
- docID
  // maps to Document.docId [many to 1]
- supersededBy 
  (type: string [docId])

// Table: Document-XMLNamespace
- xmlnsId
 // Superseded ID
- docID
  // maps to Document.docId [many to 1]
- xmlNamespace 
  (type: URI)

-----

// Table: Group
- groupId
  (type: int, increment [XXXXXX])
- groupName
  (type: string, calc: IF groupType = "TC", then enum ["10E", "20F", "21DC", "24TB", "30MR", "31FS", "32NF", "34CS", "35PM"])
- groupLink 
  (type: URL)
- groupType
  (type: string, enum ["TC", "AHG", "WG", DG", "SG", "TF"])

