-----

Table: Project

- projectId 
  (type: int, increment [XXXXXX])

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



// Table: Project-Milestone
- milestoneId
  // Milestone ID
- draftID 
  // maps to DraftDocument.draftId [1 to 1], used for ballot packages for example


-----

// Table: Document
- docId 
  (type: string, unique [simplified docLabel, lowercase, no space, misc characters subbed with dashes (i.e. "st430-17-20XX") ])
- docLabel
  (type: string [document number formatted as "ST 430-17:20XX"])
  - calc'd as: abbre. docType + " " + docNumber + "-" + docPart + docElement + ":" + publicationDateYear
- publicationDate 
  (type: string) 
  // to be updated to date type later
  - calc'd as: publicationDateYear + "-" + publicationDateMonth + "-01T07:00:00.000Z"

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

