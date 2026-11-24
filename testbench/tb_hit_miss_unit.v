// Unit test: hit_miss_unit. Exhaustive truth table: hit = valid && tag_match, miss = !hit.
// The case that matters most: an invalid line must miss even when the tags match.
`timescale 1ns/1ps
module tb_hit_miss_unit;
    reg v, t;  wire hit, miss;
    hit_miss_unit dut (.valid(v), .tag_match(t), .hit(hit), .miss(miss));
    integer errors = 0, checks = 0;
    task chk(input exp_hit, input [255:0] what);
        begin
            checks = checks + 2;
            if (hit !== exp_hit)  begin errors = errors + 1; $display("FAIL %0s: hit=%b expected %b", what, hit, exp_hit); end
            if (miss !== !exp_hit) begin errors = errors + 1; $display("FAIL %0s: miss=%b expected %b", what, miss, !exp_hit); end
        end
    endtask
    initial begin
        v = 0; t = 0; #1; chk(0, "invalid, tags differ");
        v = 0; t = 1; #1; chk(0, "invalid, tags match -> still a miss");
        v = 1; t = 0; #1; chk(0, "valid, tags differ");
        v = 1; t = 1; #1; chk(1, "valid, tags match");
        if (errors == 0) $display("tb_hit_miss_unit: PASS (%0d checks, 0 failures)", checks);
        else begin $display("tb_hit_miss_unit: FAIL (%0d of %0d checks failed)", errors, checks); $fatal(1); end
        $finish;
    end
endmodule
