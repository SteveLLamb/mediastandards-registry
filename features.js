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

  var table = $('#sorttable').DataTable();
  table
   .search( '' )
   .columns().search( '' )
   .draw();

  $('#sorttable').DataTable().searchPanes.rebuildPane();
  $('#sorttable').DataTable().order([0, 'asc']).draw();

});

/* DataTable options for sort headers and filtering */

$(document).ready(function() {

    var dt = $('#sorttable').DataTable( {
      "paging": false,
      fixedHeader: true,
      responsive: true,
      searchPanes:{
        cascadePanes: true,
        emptyMessage:"<i><b>Empty</b></i>",
        dtOpts: {
          select: {
              style: 'multi'
          }
        },  
        layout: 'columns-4',
        viewTotal: true,
        columns: [1, 2, 3, 4]
      },
      dom: "<'row'<'col-sm-12'P>>" +
          "<'row'<'col-sm-6'i><'col-sm-6'f>>" +
          "<'row'<'col-sm-12't>>",
      language: {
          searchPanes: {
              loadMessage: 'Loading filtering options...'
          }
      },
      columnDefs:[
        {
          searchPanes: {
            options:[
              {
                label: 'Accessibility',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Accessibility]');
                }
              },
              {
                label: 'Archive',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Archive]');
                }
              },
              {
                label: 'Audio',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Audio]');
                }
              },
              {
                label: 'Aux Data',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Aux Data]');
                }
              },
              {
                label: 'Captions',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Captions]');
                }
              },
              {
                label: 'Cinema Sound',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Cinema Sound]');
                }
              },
              {
                label: 'DCDM',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[DCDM]');
                } 
              },
              {
                label: 'DCinema',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[DCinema]');
                }
              },
              {
                label: 'DCP Application',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[DCP Application]');
                }
              },
              {
                label: 'DCP Core',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[DCP Core]');
                }
              },
              {
                label: 'Digital Source',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Digital Source]');
                }
              },
              {
                label: 'Distribution',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Distribution]');
                }
              },
              {
                label: 'Image',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Image]');
                }
              },
              {
                label: 'IMF',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[IMF]');
                }
              },
              {
                label: 'IMF Application',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[IMF Application]');
                }
              },
              {
                label: 'Immersive Audio',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Immersive Audio]');
                }
              },
              {
                label: 'Interop',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Interop]');
                }
              },
              {
                label: 'JPEG2000',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[JPEG2000]');
                }
              },
              {
                label: 'KDM',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[KDM]');
                }
              },
              {
                label: 'Measurement',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Measurement]');
                }
              },
              {
                label: 'Metadata',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Metadata]');
                }
              },
              {
                label: 'MXF Application',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[MXF Application]');
                }
              },
              {
                label: 'MXF Core',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[MXF Core]');
                }
              },
              {
                label: 'None Defined',
                value: function(rowData, rowIdx){
                    return rowData[3] == '';
                }
              },
              {
                label: 'Operations',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Operations]');
                }
              },
              {
                label: 'Packaging',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Packaging]');
                }
              },
              {
                label: 'Processing',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Processing]');
                }
              },
              {
                label: 'Projection',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Projection]');
                }
              },
              {
                label: 'Quality',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Quality]');
                }
              },
              {
                label: 'SDI',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[SDI]');
                }
              },
              {
                label: 'Security',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Security]');
                }
              },
              {
                label: 'Sign Language',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Sign Language]');
                }
              },
              {
                label: 'Sound',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Sound]');
                }
              },
              {
                label: 'Subtitles',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[Subtitles]');
                }
              },
              {
                label: 'XML',
                value: function(rowData, rowIdx){
                    return rowData[3].includes('[XML]');
                }
              }
            ]
          },
          targets:[3],
        },
        {
          searchPanes: {
            options:[
              {
                label: 'Active',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Active ]');
                }

              },
              {
                label: 'Amended',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Amended ]');
                }

              },
              {
                label: 'Draft',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Draft ]');
                }

              },
              {
                label: 'Reaffirmed',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Reaffirmed ]');
                }

              },
              {
                label: 'Stabilized',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Stabilized ]');
                }

              },
              {
                label: 'Superseded',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Superseded ]');
                }

              },
              {
                label: 'Unknown',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Unknown ]');
                }

              },
              {
                label: 'Withdrawn',
                value: function(rowData, rowIdx){
                  return rowData[4].includes('[ Withdrawn ]');
                }

              }
            ]
          },
          targets: [4]
        },
      ]
    });

    dt.on('select.dt', () => {          
      dt.searchPanes.rebuildPane(0, true);
    });
 
    dt.on('deselect.dt', () => {
      dt.searchPanes.rebuildPane(0, true);
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