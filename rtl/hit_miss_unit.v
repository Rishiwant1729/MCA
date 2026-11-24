// Hit / miss decision.
//   hit  = valid && tag_match      (an invalid line is always a miss, whatever tag it holds)
//   miss = !hit
// Pure combinational logic.
module hit_miss_unit (
    input  wire valid,        // valid bit of the selected line
    input  wire tag_match,    // from tag_comparator
    output wire hit,
    output wire miss
);
    assign hit  = valid & tag_match;
    assign miss = ~hit;
endmodule
