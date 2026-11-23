//! Drafts a document from a JSON file of answers, prints it, and writes the
//! Word file.
//!
//!   cargo run -p ldoc-core --example draft -- <document-id> <answers.json> <out.docx>

use ldoc_core::{Answers, draft, to_docx};
use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let [id, answers_path, out_path] = args.as_slice() else {
        eprintln!("usage: draft <document-id> <answers.json> <out.docx>");
        return ExitCode::from(2);
    };
    let json = fs::read_to_string(answers_path).expect("the answers file");
    let answers: Answers = serde_json::from_str(&json).expect("answers as JSON");
    let drafted = match draft(id, &answers) {
        Ok(drafted) => drafted,
        Err(error) => {
            eprintln!("{error:?}");
            return ExitCode::FAILURE;
        }
    };
    println!("{}\n", drafted.document.plain_text());
    for line in &drafted.costs {
        println!("{}: {} ({})", line.label, line.amount, line.basis);
    }
    for notice in &drafted.notices {
        println!("- {notice}");
    }
    fs::write(out_path, to_docx(&drafted.document).expect("a docx")).expect("the output file");
    ExitCode::SUCCESS
}
