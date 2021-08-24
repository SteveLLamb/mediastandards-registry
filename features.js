/* Filter accross all collumns in table */

$(document).ready(function(){
  $("#search").on("input", function() {
    var value = $(this).val().toLowerCase();
    $("#searchTable tr").filter(function() {
      $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
    });
  });
});

/* Clear filtering */

$(document).on('click', '.clear-filter', function(){       

  var table = $('#sorttableDocs').DataTable();
  table
   .search( '' )
   .columns().search( '' )
   .draw();

  $('#sorttableDocs').DataTable().searchPanes.clearSelections();
  $('#sorttableDocs').DataTable().order([0, 'asc']).draw();

});

/* DataTable options for sort headers and filtering - Documents*/

$(document).ready(function() {

    var dt = $('#sorttableProjs').DataTable( {
      paging: false,
      responsive: true,
      fixedHeader: true,
      buttons: [
        {
          extend: 'searchPanes',
          config:{
            cascadePanes: true,
            emptyMessage:"<i><b>Empty</b></i>",
            dtOpts: {
              select: {
                  style: 'multi'
              }
            }, 
            layout: 'columns-5',
            viewTotal: true,
            columns: [8, 3, 5, 6, 10]
          }
        },
        {
          text: 'Clear All Filters',
          action: function ( e, dt, node, config ) {
            var table = $('#sorttableProjs').DataTable();
            table
             .search( '' )
             .columns().search( '' )
             .draw();

            $('#sorttableProjs').DataTable().searchPanes.clearSelections();
            $('#sorttableProjs').DataTable().order([0, 'asc']).draw();
          }
        }
      ],
      dom: 
        "<'row'<'col d-print-none d-flex align-items-center'B><'col d-flex justify-content-center align-items-center'i><'col d-print-none d-flex justify-content-end align-items-center'f>>" +
        "<'row'<'col-sm-12't>>",
      language: {
        processing: "Loading filtering options...",
        searchPanes: {
          collapse: {0: 'Filter Options', _: 'Filter Options (%d)'}
        }
      },
      columnDefs:[
        {
          visible: false,
          targets:[3],
          searchPanes: {
            header: "Work Type"
          }
        },
        {
          visible: false,
          targets:[5],
          searchPanes: {
            header: "Approved"
          }
        },
        {
          visible: false,
          targets:[8],
          searchPanes: {
            header: "Group"
          }
        },
        {
          visible: false,
          searchPanes: {
            header: "Milestone",
            dtOpts: {
              order: [[1, 'desc']]
            },
            options:[
              {
                label: 'Awaiting ST Objection Disposition Vote (5%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Awaiting ST Objection Disposition Vote (5%)');
                }
              },
              {
                label: 'Waiting for Group Assignment (15%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Waiting for Group Assignment (15%)');
                }
              },
              {
                label: 'WG/DG working on WD (20%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('WG/DG working on WD (20%)');
                }
              },
              {
                label: 'WD (22.5%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('WD (22.5%)');
                }
              },
              {
                label: 'CD (25%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('CD (25%)');
                }
              },
              {
                label: 'Pre-FCD Review (30%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Pre-FCD Review (30%)');
                }
              },
              {
                label: 'Pre-RDD Review (30%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Pre-RDD Review (30%)');
                }
              },
              {
                label: 'CD Waiting for FCD Ballot (40%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('CD Waiting for FCD Ballot (40%)');
                }
              },
              {
                label: 'CD Waiting for RDD Ballot (40%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('CD Waiting for RDD Ballot (40%)');
                }
              },
              {
                label: 'CD Waiting for Submission to SVP (40%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('CD Waiting for Submission to SVP (40%)');
                }
              },
              {
                label: 'PCD (45%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('PCD (45%)');
                }
              },
              {
                label: 'FCD Ballot (50%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('FCD Ballot (50%)');
                }
              },
              {
                label: 'RDD Ballot (50%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('RDD Ballot (50%)');
                }
              },
              {
                label: 'FCD Ballot Comment Resolution (60%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('FCD Ballot Comment Resolution (60%)');
                }
              },
              {
                label: 'RDD Ballot Comment Resolution (60%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('RDD Ballot Comment Resolution (60%)');
                }
              },
              {
                label: 'FCD (65%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('FCD (65%)');
                }
              },
              {
                label: 'Pre-DP Review (70%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Pre-DP Review (70%)');
                }
              },
              {
                label: 'RDD (75%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('RDD (75%)');
                }
              },
              {
                label: 'DP Ballot (80%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('DP Ballot (80%)');
                }
              },
              {
                label: 'SVP Review',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('SVP Review');
                }
              },
              {
                label: 'DP (85%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('DP (85%)');
                }
              },
              {
                label: 'ST Audit (90%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('ST Audit (90%)');
                }
              },
              {
                label: 'Document in HQ (95%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Document in HQ (95%)');
                }
              },
              {
                label: 'Published (100%)',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Published (100%)');
                }
              },
              {
                label: 'Uploaded to TC Ref Docs',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Uploaded to TC Ref Docs');
                }
              },
              {
                label: 'Archive',
                value: function(rowData, rowIdx){
                  return rowData[10].includes('Archive');
                }
              }
            ]
          },
          targets: [10]
        }
      ]
    });

});

/* DataTable options for sort headers and filtering - Documents*/

$(document).ready(function() {

    var dt = $('#sorttableDocs').DataTable( {
      paging: false,
      processing: true,
      responsive: true,      
      buttons: [
          {
          extend: 'searchPanes',
          config:{
            cascadePanes: true,
            emptyMessage:"<i><b>Empty</b></i>",
            dtOpts: {
              select: {
                  style: 'multi'
              }
            }, 
            layout: 'columns-5',
            viewTotal: true,
            columns: [1, 3, 4, 5, 6]
          }
        },
        {
          text: 'Clear All Filters',
          action: function ( e, dt, node, config ) {
            var table = $('#sorttableDocs').DataTable();
            table
             .search( '' )
             .columns().search( '' )
             .draw();

            $('#sorttableDocs').DataTable().searchPanes.clearSelections();
            $('#sorttableDocs').DataTable().order([0, 'asc']).draw();
          }
        }
      ],
      dom: 
        "<'row'<'col d-print-none d-flex align-items-center'B><'col d-flex justify-content-center align-items-center'i><'col d-print-none d-flex justify-content-end align-items-center'f>>" +
        "<'row'<'col-sm-12't>>",
      language: {
        processing: "Loading filtering options...",
        searchPanes: {
          collapse: {0: 'Filter Options', _: 'Filter Options (%d)'}
        }
      },
      columnDefs:[
        {
          visible: false,
          targets:[3],
          searchPanes: {
            header: "Group"
          }
        },
        {
          searchPanes: {
            orthogonal: 'sp',
          },
          render: function (data, type, row) {
          
          if (type === 'sp') {
            
            var keywords = [];
            $( $(data), "i" ).each(function( index ) {
              var val = $( this ).text();
              val = val.trim();
              if (val.length > 0) {
                keywords.push(val);
              }
            });

           return keywords;
          }
          return data;
          },
          targets:[5],
        },
        {
          searchPanes: {
            options:[
              {
                label: 'Active',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ ACTIVE ]');
                }
              },
              {
                label: 'Amended',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ AMENDED ]');
                }
              },
              {
                label: 'Draft',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ DRAFT ]');
                }
              },
              {
                label: 'Public CD',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ PUBLIC CD ]');
                }
              },
              {
                label: 'Reaffirmed',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ REAFFIRMED ]');
                }
              },
              {
                label: 'Stabilized',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ STABILIZED ]');
                }
              },
              {
                label: 'Superseded',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ SUPERSEDED ]');
                }
              },
              {
                label: 'Unknown',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ UNKNOWN ]');
                }
              },
              {
                label: 'Withdrawn',
                value: function(rowData, rowIdx){
                  return rowData[6].includes('[ WITHDRAWN ]');
                }
              }
            ]
          },
          targets: [6]
        }
      ]
    });

});

/* "Back To Top" button functionality */

$(document).ready(function() {
$(window).scroll(function() {
if ($(this).scrollTop() > 20) {
$('#toTopBtn').fadeIn();
} else {
$('#toTopBtn').fadeOut();
}
});

$('#toTopBtn').click(function() {
$("html, body").animate({
scrollTop: 0
}, 1000);
return false;
});
});